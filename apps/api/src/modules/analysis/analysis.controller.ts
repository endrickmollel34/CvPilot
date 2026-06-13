import { Controller, Post, Get, Param, Body, UseGuards, Sse } from '@nestjs/common';

import { ClerkGuard } from '../auth/guards/clerk.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AnalysisService } from './analysis.service';

@Controller('analyses')
@UseGuards(ClerkGuard)
export class AnalysisController {
  constructor(private readonly analysisService: AnalysisService) {}

  @Post()
  createAnalysis(
    @CurrentUser() user: { clerkId: string },
    @Body() body: { cvId: string; jobTitle: string; companyName: string; jobDescription: string },
  ) {
    return this.analysisService.createAnalysis(user.clerkId, body);
  }

  @Get()
  listAnalyses(@CurrentUser() user: { clerkId: string }) {
    return this.analysisService.listForUser(user.clerkId);
  }

  @Get(':id')
  getAnalysis(@CurrentUser() user: { clerkId: string }, @Param('id') id: string) {
    return this.analysisService.findOneForUser(user.clerkId, id);
  }

  @Sse(':id/status')
  statusStream(@Param('id') id: string) {
    return this.analysisService.statusStream(id);
  }
}
