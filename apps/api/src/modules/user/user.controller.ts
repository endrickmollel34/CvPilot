import { Controller, Get, Delete, UseGuards } from '@nestjs/common';

import { ClerkGuard } from '../auth/guards/clerk.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserService } from './user.service';

@Controller('users')
@UseGuards(ClerkGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('me')
  getMe(@CurrentUser() user: { clerkId: string }) {
    return this.userService.findByClerkId(user.clerkId);
  }

  @Delete('me')
  deleteMe(@CurrentUser() user: { clerkId: string }) {
    // 'abort': self-service deletion — the caller's Clerk identity still
    // exists, so a failed Stripe cancellation must stop the deletion
    // entirely (rather than default implicitly) so they can retry.
    return this.userService.deleteByClerkId(user.clerkId, 'abort');
  }
}
