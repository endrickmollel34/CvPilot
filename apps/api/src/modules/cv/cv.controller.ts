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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CvService } from './cv.service';
import type { GenerateUploadUrlDto } from './dto/generate-upload-url.dto';
import type { ConfirmUploadDto } from './dto/confirm-upload.dto';
import type { CreateCvDto } from './dto/create-cv.dto';
import type { UpdateCvContentDto } from './dto/update-cv-content.dto';
import type { RenameCvDto } from './dto/rename-cv.dto';
import type { ReorderCvSectionsDto } from './dto/reorder-cv-sections.dto';

@Controller('cvs')
@UseGuards(ClerkGuard)
export class CvController {
  constructor(private readonly cvService: CvService) {}

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

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCv(@CurrentUser() user: { clerkId: string }, @Param('id') id: string): Promise<void> {
    await this.cvService.deleteCv(user.clerkId, id);
  }

  @Post(':id/prefill')
  prefill(@CurrentUser() user: { clerkId: string }, @Param('id') id: string) {
    return this.cvService.prefillFromUpload(user.clerkId, id);
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
