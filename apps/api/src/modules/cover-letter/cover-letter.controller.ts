import { Controller, Post, Get, Patch, Param, Body, UseGuards } from '@nestjs/common';

import { ClerkGuard } from '../auth/guards/clerk.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { CoverLetterService } from './cover-letter.service';

@Controller('cover-letters')
@UseGuards(ClerkGuard)
export class CoverLetterController {
  constructor(private readonly coverLetterService: CoverLetterService) {}

  @Post()
  generate(
    @CurrentUser() user: { clerkId: string },
    @Body()
    body: {
      cvId: string;
      analysisId?: string;
      jobTitle: string;
      companyName: string;
      jobDescription: string;
    },
  ) {
    return this.coverLetterService.generate(user.clerkId, body);
  }

  @Get()
  list(@CurrentUser() user: { clerkId: string }) {
    return this.coverLetterService.listForUser(user.clerkId);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: { clerkId: string },
    @Param('id') id: string,
    @Body() body: { content: string },
  ) {
    return this.coverLetterService.update(user.clerkId, id, body.content);
  }

  @Post(':id/download')
  download(
    @CurrentUser() user: { clerkId: string },
    @Param('id') id: string,
    @Body() body: { format: 'pdf' | 'docx' },
  ) {
    return this.coverLetterService.getDownloadUrl(user.clerkId, id, body.format);
  }
}
