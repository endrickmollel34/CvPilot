import { Controller, Post, Body, Headers } from '@nestjs/common';

import type { AuthService } from './auth.service';

@Controller('webhooks')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('clerk')
  handleClerkWebhook(
    @Headers('svix-id') svixId: string,
    @Headers('svix-timestamp') svixTimestamp: string,
    @Headers('svix-signature') svixSignature: string,
    @Body() payload: unknown,
  ) {
    return this.authService.handleClerkWebhook({ svixId, svixTimestamp, svixSignature }, payload);
  }
}
