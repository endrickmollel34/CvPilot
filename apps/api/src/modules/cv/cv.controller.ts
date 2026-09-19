import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';

import { ClerkGuard } from '../auth/guards/clerk.guard';
import { AiRateLimitGuard } from '../../common/rate-limit/ai-rate-limit.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CvService } from './cv.service';
import { CvPhotoService } from './cv-photo.service';
import { GenerateUploadUrlDto } from './dto/generate-upload-url.dto';
import { ConfirmUploadDto } from './dto/confirm-upload.dto';
import { CreateCvDto } from './dto/create-cv.dto';
import { UpdateCvContentDto } from './dto/update-cv-content.dto';
import { RenameCvDto } from './dto/rename-cv.dto';
import { ReorderCvSectionsDto } from './dto/reorder-cv-sections.dto';
import { UpdateCvTemplateDto } from './dto/update-cv-template.dto';
import { PhotoUploadUrlDto } from './dto/photo-upload-url.dto';
import { ConfirmPhotoUploadDto } from './dto/confirm-photo-upload.dto';

@Controller('cvs')
@UseGuards(ClerkGuard)
export class CvController {
  constructor(
    private readonly cvService: CvService,
    private readonly cvPhotoService: CvPhotoService,
  ) {}

  // Upload flow
  @Post('upload-url')
  getUploadUrl(@CurrentUser() user: { clerkId: string }, @Body() dto: GenerateUploadUrlDto) {
    return this.cvService.generateUploadUrl(user.clerkId, dto);
  }

  @Post('confirm')
  confirmUpload(@CurrentUser() user: { clerkId: string }, @Body() dto: ConfirmUploadDto) {
    return this.cvService.confirmUpload(user.clerkId, dto);
  }

  // Builder flow
  @Post()
  create(@CurrentUser() user: { clerkId: string }, @Body() dto: CreateCvDto) {
    return this.cvService.createBuilder(user.clerkId, dto);
  }

  @Patch(':id')
  updateContent(
    @CurrentUser() user: { clerkId: string },
    @Param('id') id: string,
    @Body() dto: UpdateCvContentDto,
  ) {
    return this.cvService.updateContent(user.clerkId, id, dto);
  }

  @Patch(':id/title')
  rename(
    @CurrentUser() user: { clerkId: string },
    @Param('id') id: string,
    @Body() dto: RenameCvDto,
  ) {
    return this.cvService.rename(user.clerkId, id, dto);
  }

  @Patch(':id/reorder')
  reorder(
    @CurrentUser() user: { clerkId: string },
    @Param('id') id: string,
    @Body() dto: ReorderCvSectionsDto,
  ) {
    return this.cvService.reorderSections(user.clerkId, id, dto);
  }

  @Patch(':id/template')
  updateTemplate(
    @CurrentUser() user: { clerkId: string },
    @Param('id') id: string,
    @Body() dto: UpdateCvTemplateDto,
  ) {
    return this.cvService.updateTemplate(user.clerkId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCv(@CurrentUser() user: { clerkId: string }, @Param('id') id: string): Promise<void> {
    await this.cvService.deleteCv(user.clerkId, id);
  }

  // Paid AI entry point — a real, synchronous OpenAI (GPT-4o-mini) call
  // (see PrefillExtractionService), previously the only one of the five
  // with no AI-specific rate limiting or plan-usage quota at all — see
  // AnalysisController's own comment for how the guard fits into the
  // request pipeline.
  @Post(':id/prefill')
  @UseGuards(AiRateLimitGuard)
  prefill(@CurrentUser() user: { clerkId: string }, @Param('id') id: string) {
    return this.cvService.prefillFromUpload(user.clerkId, id);
  }

  // Profile template's optional photo
  @Post(':id/photo/upload-url')
  getPhotoUploadUrl(
    @CurrentUser() user: { clerkId: string },
    @Param('id') id: string,
    @Body() dto: PhotoUploadUrlDto,
  ) {
    return this.cvPhotoService.generateUploadUrl(user.clerkId, id, dto);
  }

  @Post(':id/photo/confirm')
  confirmPhotoUpload(
    @CurrentUser() user: { clerkId: string },
    @Param('id') id: string,
    @Body() dto: ConfirmPhotoUploadDto,
  ) {
    return this.cvPhotoService.confirmUpload(user.clerkId, id, dto);
  }

  @Delete(':id/photo')
  removePhoto(@CurrentUser() user: { clerkId: string }, @Param('id') id: string) {
    return this.cvPhotoService.removePhoto(user.clerkId, id);
  }

  @Get(':id/photo/preview-url')
  getPhotoPreviewUrl(@CurrentUser() user: { clerkId: string }, @Param('id') id: string) {
    return this.cvPhotoService.getPreviewUrl(user.clerkId, id);
  }

  @Get(':id/download')
  async downloadPdf(
    @CurrentUser() user: { clerkId: string },
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    res.setHeader('Cache-Control', 'no-store');
    const { stream, filename } = await this.cvService.generatePdfStream(user.clerkId, id);
    return new StreamableFile(stream, {
      type: 'application/pdf',
      disposition: `attachment; filename="${filename}"`,
    });
  }

  // Shared
  @Get()
  listCvs(@CurrentUser() user: { clerkId: string }) {
    return this.cvService.listForUser(user.clerkId);
  }

  @Get(':id')
  getCv(@CurrentUser() user: { clerkId: string }, @Param('id') id: string) {
    return this.cvService.findOneForUser(user.clerkId, id);
  }
}
