import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type Repository } from 'typeorm';

import { UserEntity } from '../../entities/user.entity';
import { ProfileEntity } from '../../entities/profile.entity';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(ProfileEntity)
    private readonly profileRepo: Repository<ProfileEntity>,
  ) {}

  /**
   * Atomically insert-or-update a user from a Clerk webhook event.
   * Uses PostgreSQL ON CONFLICT to eliminate the TOCTOU race that would occur
   * if two concurrent Clerk webhook deliveries both tried to create the same user.
   */
  async findOrCreateByClerkId(clerkId: string, email: string): Promise<UserEntity> {
    await this.userRepo.upsert(
      { clerkId, email },
      { conflictPaths: ['clerkId'], skipUpdateIfNoValuesChanged: true },
    );
    return this.userRepo.findOneByOrFail({ clerkId });
  }

  async findByClerkId(clerkId: string): Promise<UserEntity> {
    const user = await this.userRepo.findOne({
      where: { clerkId },
      relations: ['profile'],
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async deleteByClerkId(clerkId: string): Promise<void> {
    const user = await this.findByClerkId(clerkId);
    await this.userRepo.softDelete(user.id);
    // TODO: schedule R2 CV file deletion, emit gdpr.erasure.requested event
  }
}
