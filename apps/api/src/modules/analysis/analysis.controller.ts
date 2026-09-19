import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  UseGuards,
  Sse,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Observable } from 'rxjs';

import { ClerkGuard } from '../auth/guards/clerk.guard';
import { AiRateLimitGuard } from '../../common/rate-limit/ai-rate-limit.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AnalysisService } from './analysis.service';
import { CreateAnalysisDto } from './dto/create-analysis.dto';

@Controller('analyses')
@UseGuards(ClerkGuard)
export class AnalysisController {
  constructor(private readonly analysisService: AnalysisService) {}

  // Paid AI entry point — rate-limited across analysis/cover-letter/
  // tailoring/prefill by AiRateLimitGuard (see its own doc comment; runs
  // after ClerkGuard above, before this enqueues anything or checks plan
  // quota).
  @Post()
  @UseGuards(AiRateLimitGuard)
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

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteAnalysis(
    @CurrentUser() user: { clerkId: string },
    @Param('id') id: string,
  ): Promise<void> {
    await this.analysisService.deleteAnalysis(user.clerkId, id);
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
