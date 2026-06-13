import { Controller, Get, UseGuards } from '@nestjs/common';

import { ClerkGuard } from '../auth/guards/clerk.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { DashboardService } from './dashboard.service';

@Controller('dashboard')
@UseGuards(ClerkGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  getSummary(@CurrentUser() user: { clerkId: string }) {
    return this.dashboardService.getSummary(user.clerkId);
  }
}
