import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { ContactService } from './contact.service';
import { SubmitContactDto } from './dto/submit-contact.dto';

@Controller('contact')
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  // Deliberately no @UseGuards(ClerkGuard) — this must be reachable by
  // anonymous visitors, matching the public /contact page. Throttled far
  // tighter than the app-wide default (100 req/min/IP, set in
  // app.module.ts) since this endpoint sends an email per request and has
  // no other cost/quota gate — 5 req/min/IP is generous for a genuine
  // visitor filling in one form, but blunts a naive scripted flood.
  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async submit(@Body() dto: SubmitContactDto): Promise<void> {
    await this.contactService.submit(dto);
  }
}
