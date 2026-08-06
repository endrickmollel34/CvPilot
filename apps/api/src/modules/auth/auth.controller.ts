import type { RawBodyRequest } from '@nestjs/common';
import { Controller, Post, Headers, Req } from '@nestjs/common';
import type { Request } from 'express';

import { AuthService } from './auth.service';

@Controller('webhooks')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // Clerk requires raw body for Svix signature verification — no JSON middleware on this route
  @Post('clerk')
  handleClerkWebhook(
    @Headers('svix-id') svixId: string,
    @Headers('svix-timestamp') svixTimestamp: string,
    @Headers('svix-signature') svixSignature: string,
    @Req() request: RawBodyRequest<Request>,
  ) {
    return this.authService.handleClerkWebhook(
      { svixId, svixTimestamp, svixSignature },
      request.rawBody!,
    );
  }
}
