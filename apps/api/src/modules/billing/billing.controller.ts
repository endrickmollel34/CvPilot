import type { RawBodyRequest } from '@nestjs/common';
import { Controller, Post, Body, Headers, Req, UseGuards, Get } from '@nestjs/common';
import type { Request } from 'express';

import { ClerkGuard } from '../auth/guards/clerk.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { BillingService } from './billing.service';

@Controller()
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  // Stripe requires raw body for signature verification — no JSON middleware on this route
  @Post('webhooks/stripe')
  handleStripeWebhook(
    @Headers('stripe-signature') signature: string,
    @Req() request: RawBodyRequest<Request>,
  ) {
    return this.billingService.handleStripeWebhook(signature, request.rawBody!);
  }

  @Post('billing/checkout')
  @UseGuards(ClerkGuard)
  createCheckout(
    @CurrentUser() user: { clerkId: string },
    @Body() body: { plan: 'pro' | 'student' },
  ) {
    return this.billingService.createCheckoutSession(user.clerkId, body.plan);
  }

  @Post('billing/portal')
  @UseGuards(ClerkGuard)
  createPortal(@CurrentUser() user: { clerkId: string }) {
    return this.billingService.createPortalSession(user.clerkId);
  }

  @Get('billing/subscription')
  @UseGuards(ClerkGuard)
  getSubscription(@CurrentUser() user: { clerkId: string }) {
    return this.billingService.getSubscription(user.clerkId);
  }
}
