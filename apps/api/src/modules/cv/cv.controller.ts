import { Controller, Post, Body, Get, Param, UseGuards } from '@nestjs/common';

import { ClerkGuard } from '../auth/guards/clerk.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { CvService } from './cv.service';
import type { GenerateUploadUrlDto } from './dto/generate-upload-url.dto';
import type { ConfirmUploadDto } from './dto/confirm-upload.dto';

@Controller('cvs')
@UseGuards(ClerkGuard)
export class CvController {
  constructor(private readonly cvService: CvService) {}

  @Post('upload-url')
  getUploadUrl(@CurrentUser() user: { clerkId: string }, @Body() dto: GenerateUploadUrlDto) {
    return this.cvService.generateUploadUrl(user.clerkId, dto);
  }

  @Post('confirm')
  confirmUpload(@CurrentUser() user: { clerkId: string }, @Body() dto: ConfirmUploadDto) {
    return this.cvService.confirmUpload(user.clerkId, dto);
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
