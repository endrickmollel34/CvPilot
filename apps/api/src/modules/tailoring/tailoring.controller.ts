import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';

import { ClerkGuard } from '../auth/guards/clerk.guard';
import { AiRateLimitGuard } from '../../common/rate-limit/ai-rate-limit.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TailoringService } from './tailoring.service';
import { CreateTailoringDto } from './dto/create-tailoring.dto';
import { ApplySuggestionsDto } from './dto/apply-suggestions.dto';

@Controller('tailorings')
@UseGuards(ClerkGuard)
export class TailoringController {
  constructor(private readonly tailoringService: TailoringService) {}

  // Paid AI entry point — see AnalysisController's own comment. (apply()
  // below applies already-generated suggestions to CV content — no new AI
  // call — so it's deliberately NOT guarded here.)
  @Post()
  @UseGuards(AiRateLimitGuard)
  submit(@CurrentUser() user: { clerkId: string }, @Body() dto: CreateTailoringDto) {
    return this.tailoringService.submit(user.clerkId, dto);
  }

  @Get()
  list(@CurrentUser() user: { clerkId: string }) {
    return this.tailoringService.listForUser(user.clerkId);
  }

  @Get(':id')
  findOne(@CurrentUser() user: { clerkId: string }, @Param('id') id: string) {
    return this.tailoringService.findOneForUser(user.clerkId, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: { clerkId: string }, @Param('id') id: string): Promise<void> {
    await this.tailoringService.deleteTailoring(user.clerkId, id);
  }

  @Post(':id/apply')
  @HttpCode(HttpStatus.OK)
  apply(
    @CurrentUser() user: { clerkId: string },
    @Param('id') id: string,
    @Body() dto: ApplySuggestionsDto,
  ) {
    return this.tailoringService.apply(user.clerkId, id, dto);
  }
}
