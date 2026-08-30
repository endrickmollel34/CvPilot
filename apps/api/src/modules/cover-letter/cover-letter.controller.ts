import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Sse,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Observable } from 'rxjs';

import { ClerkGuard } from '../auth/guards/clerk.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CoverLetterService } from './cover-letter.service';
import { CreateCoverLetterDto } from './dto/create-cover-letter.dto';
import { UpdateCoverLetterDto } from './dto/update-cover-letter.dto';
import { ListCoverLettersDto } from './dto/list-cover-letters.dto';

@Controller('cover-letters')
@UseGuards(ClerkGuard)
export class CoverLetterController {
  constructor(private readonly coverLetterService: CoverLetterService) {}

  @Post()
  submit(@CurrentUser() user: { clerkId: string }, @Body() dto: CreateCoverLetterDto) {
    return this.coverLetterService.submit(user.clerkId, dto);
  }

  @Get()
  list(@CurrentUser() user: { clerkId: string }, @Query() dto: ListCoverLettersDto) {
    return this.coverLetterService.listForUser(user.clerkId, dto);
  }

  @Get(':id')
  findOne(@CurrentUser() user: { clerkId: string }, @Param('id') id: string) {
    return this.coverLetterService.findOneForUser(user.clerkId, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: { clerkId: string },
    @Param('id') id: string,
    @Body() dto: UpdateCoverLetterDto,
  ) {
    return this.coverLetterService.update(user.clerkId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: { clerkId: string }, @Param('id') id: string): Promise<void> {
    await this.coverLetterService.softDelete(user.clerkId, id);
  }

  @Sse(':id/status')
  async statusStream(
    @CurrentUser() user: { clerkId: string },
    @Param('id') id: string,
  ): Promise<Observable<MessageEvent>> {
    // ownership check before opening stream
    await this.coverLetterService.findOneForUser(user.clerkId, id);
    return this.coverLetterService.statusStream(id);
  }

  @Post(':id/download')
  download(@CurrentUser() user: { clerkId: string }, @Param('id') id: string) {
    return this.coverLetterService.getDownloadUrl(user.clerkId, id);
  }
}
