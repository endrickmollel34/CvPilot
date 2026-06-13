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

  async upsertFromClerk(clerkId: string, email: string): Promise<UserEntity> {
    let user = await this.userRepo.findOneBy({ clerkId });
    if (!user) {
      user = this.userRepo.create({ clerkId, email });
      await this.userRepo.save(user);
    }
    return user;
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
    // Soft-delete: sets deleted_at via TypeORM @DeleteDateColumn
    const user = await this.findByClerkId(clerkId);
    await this.userRepo.softDelete(user.id);
    // TODO: schedule R2 CV file deletion, emit gdpr.erasure.requested event
  }
}
