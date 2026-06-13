import { Controller, Post, Body, Get, Param, UseGuards } from '@nestjs/common';

import { ClerkGuard } from '../auth/guards/clerk.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { CvService } from './cv.service';

@Controller('cvs')
@UseGuards(ClerkGuard)
export class CvController {
  constructor(private readonly cvService: CvService) {}

  @Post('upload-url')
  getUploadUrl(
    @CurrentUser() user: { clerkId: string },
    @Body() body: { fileName: string; mimeType: string; fileSizeBytes: number },
  ) {
    return this.cvService.generateUploadUrl(user.clerkId, body);
  }

  @Post('confirm')
  confirmUpload(
    @CurrentUser() user: { clerkId: string },
    @Body()
    body: { r2ObjectKey: string; fileName: string; fileSizeBytes: number; mimeType: string },
  ) {
    return this.cvService.confirmUpload(user.clerkId, body);
  }

  @Get()
  listCvs(@CurrentUser() user: { clerkId: string }) {
    return this.cvService.listForUser(user.clerkId);
  }

  @Get(':id')
  getCv(@CurrentUser() user: { clerkId: string }, @Param('id') id: string) {
    return this.cvService.findOneForUser(user.clerkId, id);
  }
}
