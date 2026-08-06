import { Controller, Post, Get, Param, Body, UseGuards, Sse } from '@nestjs/common';
import type { Observable } from 'rxjs';

import { ClerkGuard } from '../auth/guards/clerk.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AnalysisService } from './analysis.service';
import type { CreateAnalysisDto } from './dto/create-analysis.dto';

@Controller('analyses')
@UseGuards(ClerkGuard)
export class AnalysisController {
  constructor(private readonly analysisService: AnalysisService) {}

  @Post()
  submitAnalysis(@CurrentUser() user: { clerkId: string }, @Body() dto: CreateAnalysisDto) {
    return this.analysisService.submit(user.clerkId, dto);
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
  async statusStream(
    @CurrentUser() user: { clerkId: string },
    @Param('id') id: string,
  ): Promise<Observable<MessageEvent>> {
    await this.analysisService.findOneForUser(user.clerkId, id);
    return this.analysisService.statusStream(id);
  }
}
