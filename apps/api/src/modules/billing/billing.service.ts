import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type Repository, In, MoreThanOrEqual, Not } from 'typeorm';

import type { Plan, PaymentProviderType, UsageCounter, UsageSummary } from '@cvpilot/shared';
import { PLAN_LIMITS } from '@cvpilot/shared';

import { SubscriptionEntity } from '../../entities/subscription.entity';
import { PaymentEntity } from '../../entities/payment.entity';
import { AnalysisEntity, type AnalysisStatus } from '../../entities/analysis.entity';
import { CoverLetterEntity, type CoverLetterStatus } from '../../entities/cover-letter.entity';
import { TailoringEntity } from '../../entities/tailoring.entity';
import { CvEntity } from '../../entities/cv.entity';
import { isDevQuotaBypassActive } from '../../common/utils/dev-quota-bypass.util';
import { UserService } from '../user/user.service';
import { StripePaymentProvider } from './providers/stripe.provider';
import type { PaymentProvider, InternalBillingEvent } from './providers/payment-provider.interface';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly providers = new Map<PaymentProviderType, PaymentProvider>();

  constructor(
    @InjectRepository(SubscriptionEntity)
    private readonly subscriptionRepo: Repository<SubscriptionEntity>,
    @InjectRepository(PaymentEntity)
    private readonly paymentRepo: Repository<PaymentEntity>,
    @InjectRepository(AnalysisEntity)
    private readonly analysisRepo: Repository<AnalysisEntity>,
    @InjectRepository(CoverLetterEntity)
    private readonly coverLetterRepo: Repository<CoverLetterEntity>,
    @InjectRepository(TailoringEntity)
    private readonly tailoringRepo: Repository<TailoringEntity>,
    @InjectRepository(CvEntity)
    private readonly cvRepo: Repository<CvEntity>,
    private readonly userService: UserService,
    stripeProvider: StripePaymentProvider,
  ) {
    this.providers.set('STRIPE', stripeProvider);
  }

  async createCheckoutSession(
    clerkId: string,
    plan: Exclude<Plan, 'free'>,
    providerType: PaymentProviderType = 'STRIPE',
  ): Promise<{ url: string | null }> {
    const provider = this.getProvider(providerType);
    const user = await this.userService.findByClerkId(clerkId);
    const sub = await this.subscriptionRepo.findOneBy({ userId: user.id });

    return provider.createCheckoutSession({
      userId: user.id,
      providerCustomerId: sub?.providerCustomerId,
      plan,
      currency: 'GBP',
      successUrl: `${process.env['FRONTEND_URL'] ?? ''}/dashboard?checkout=success`,
      cancelUrl: `${process.env['FRONTEND_URL'] ?? ''}/dashboard?checkout=cancelled`,
    });
  }

  async createPortalSession(
    clerkId: string,
    providerType: PaymentProviderType = 'STRIPE',
  ): Promise<{ url: string }> {
    const provider = this.getProvider(providerType);
    if (!provider.createCustomerPortalSession) {
      throw new BadRequestException(`Provider ${providerType} does not support a customer portal`);
    }

    const user = await this.userService.findByClerkId(clerkId);
    const sub = await this.subscriptionRepo.findOneBy({ userId: user.id });
    if (!sub?.providerCustomerId) {
      throw new NotFoundException('No active subscription found');
    }

    return provider.createCustomerPortalSession({
      providerCustomerId: sub.providerCustomerId,
      returnUrl: `${process.env['FRONTEND_URL'] ?? ''}/dashboard`,
    });
  }

  async getSubscription(clerkId: string): Promise<SubscriptionEntity | null> {
    const user = await this.userService.findByClerkId(clerkId);
    return this.subscriptionRepo.findOneBy({ userId: user.id });
  }

  /**
   * The plan that actually governs product entitlements right now. This is
   * deliberately NOT always the same as the raw `plan` column — see
   * resolveEffectivePlan() below for why — so every quota/feature check in
   * the app (canPerformAction, CvService.checkBuilderCvLimit,
   * TailoringService.checkTailoringLimit) must call this rather than
   * reading `plan` off a subscription row directly.
   *
   * For displaying the user's real stored plan/status (e.g. "Pro — Past
   * due" on the dashboard), use getSubscription() instead, which returns
   * the raw, unmodified subscription row.
   */
  async getUserPlan(userId: string): Promise<Plan> {
    const sub = await this.subscriptionRepo.findOneBy({ userId });
    return resolveEffectivePlan(sub);
  }

  async canPerformAction(userId: string, action: 'analyse' | 'cover-letter'): Promise<boolean> {
    // DEV-ONLY quota bypass — see dev-quota-bypass.util.ts for the full
    // rationale. Never active outside NODE_ENV=development.
    if (isDevQuotaBypassActive()) return true;

    const plan = await this.getUserPlan(userId);
    const limit =
      action === 'analyse'
        ? PLAN_LIMITS[plan].analysesPerMonth
        : PLAN_LIMITS[plan].coverLettersPerMonth;

    if (limit === Infinity) return true;

    const count =
      action === 'analyse'
        ? await this.countAnalysesThisMonth(userId)
        : await this.countCoverLettersThisMonth(userId);

    return count < limit;
  }

  /**
   * Real, current usage/limits for the four quota-gated resources, for
   * display only (dashboard usage card, contextual hints). Never gated by
   * isDevQuotaBypassActive() — that bypass only ever short-circuits the
   * canPerformAction() enforcement check, and must not falsify what this
   * endpoint reports as actually used.
   *
   * Reuses the exact same counting rules as canPerformAction()
   * (countAnalysesThisMonth/countCoverLettersThisMonth) plus the same
   * month-boundary/Not('failed') pattern for tailorings, and CvService's
   * existing builder-CV-slot semantics (a live count of builder+prefill
   * CVs, not a lifetime counter) for builderCvs.
   */
  async getUsageSummary(clerkId: string): Promise<UsageSummary> {
    const user = await this.userService.findByClerkId(clerkId);
    const sub = await this.subscriptionRepo.findOneBy({ userId: user.id });
    const plan = resolveEffectivePlan(sub);
    const limits = PLAN_LIMITS[plan];

    const [analysesUsed, coverLettersUsed, tailoringsUsed, builderCvsUsed] = await Promise.all([
      this.countAnalysesThisMonth(user.id),
      this.countCoverLettersThisMonth(user.id),
      this.countTailoringsThisMonth(user.id),
      this.countBuilderCvs(user.id),
    ]);

    return {
      plan,
      ...(sub && { rawPlan: sub.plan, subscriptionStatus: sub.status }),
      usage: {
        analyses: toUsageCounter(analysesUsed, limits.analysesPerMonth),
        coverLetters: toUsageCounter(coverLettersUsed, limits.coverLettersPerMonth),
        tailorings: toUsageCounter(tailoringsUsed, limits.tailoringsPerMonth),
        builderCvs: toUsageCounter(builderCvsUsed, limits.builderCvsTotal),
      },
    };
  }

  // ── Shared quota-counting helpers ──────────────────────────────────────────
  // Single source of truth for "how many of X has this user used", reused by
  // both canPerformAction() (enforcement) and getUsageSummary() (display).
  // Failed AI generations must not consume — or appear to consume — the
  // user's quota: a transient OpenAI/Anthropic outage would otherwise
  // silently burn a Free user's tiny monthly allowance for zero result.
  // Mirrors the same Not('failed') exclusion TailoringService's own
  // checkTailoringLimit() independently applies for enforcement.

  private startOfCurrentMonth(): Date {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private async countAnalysesThisMonth(userId: string): Promise<number> {
    return this.analysisRepo.count({
      where: {
        userId,
        status: Not('failed') as unknown as AnalysisStatus,
        createdAt: MoreThanOrEqual(this.startOfCurrentMonth()),
      },
    });
  }

  private async countCoverLettersThisMonth(userId: string): Promise<number> {
    return this.coverLetterRepo.count({
      where: {
        userId,
        status: Not('failed') as unknown as CoverLetterStatus,
        createdAt: MoreThanOrEqual(this.startOfCurrentMonth()),
      },
    });
  }

  private async countTailoringsThisMonth(userId: string): Promise<number> {
    return this.tailoringRepo.count({
      where: {
        userId,
        status: Not('failed') as unknown as TailoringEntity['status'],
        createdAt: MoreThanOrEqual(this.startOfCurrentMonth()),
      },
    });
  }

  // Builder CV *slots*, not lifetime creations — mirrors
  // CvService.checkBuilderCvLimit()'s exact filter. Not month-scoped: this
  // is a total-in-existence count, matching current MVP semantics.
  private async countBuilderCvs(userId: string): Promise<number> {
    return this.cvRepo.count({ where: { userId, source: In(['builder', 'prefill']) } });
  }

  async handleWebhook(
    providerType: PaymentProviderType,
    rawBody: Buffer,
    signature: string,
  ): Promise<void> {
    const provider = this.getProvider(providerType);
    const event = await provider.verifyAndParseWebhook({ rawBody, signature });
    if (!event) return;
    await this.applyBillingEvent(event);
  }

  private getProvider(type: PaymentProviderType): PaymentProvider {
    const provider = this.providers.get(type);
    if (!provider) throw new BadRequestException(`Unknown payment provider: ${type}`);
    return provider;
  }

  private async applyBillingEvent(event: InternalBillingEvent): Promise<void> {
    this.logger.log(`Billing event: ${event.type} from ${event.provider}`);
    switch (event.type) {
      case 'subscription.activated':
        await this.onSubscriptionActivated(event);
        break;
      case 'subscription.updated':
        await this.onSubscriptionUpdated(event);
        break;
      case 'subscription.cancelled':
        await this.onSubscriptionCancelled(event);
        break;
      case 'payment.succeeded':
        await this.onPaymentSucceeded(event);
        break;
      case 'payment.failed':
        await this.onPaymentFailed(event);
        break;
    }
  }

  private async onSubscriptionActivated(event: InternalBillingEvent): Promise<void> {
    const userId = event.metadata?.['internalUserId'] as string | undefined;
    if (!userId || !event.providerCustomerId) {
      this.logger.warn('subscription.activated missing userId or providerCustomerId', event);
      return;
    }

    await this.subscriptionRepo.upsert(
      {
        userId,
        provider: event.provider,
        providerCustomerId: event.providerCustomerId,
        providerSubscriptionId: event.providerSubscriptionId,
        plan: event.plan ?? 'free',
        status: event.subscriptionStatus ?? 'active',
        paymentMethod: event.paymentMethod,
        billingCycle: 'recurring',
      },
      { conflictPaths: ['userId'] },
    );
  }

  private async onSubscriptionUpdated(event: InternalBillingEvent): Promise<void> {
    if (!event.providerCustomerId) return;

    this.logger.log(
      `Persisting subscription.updated for sub ...${event.providerSubscriptionId?.slice(-8) ?? 'unknown'}: ` +
        `status=${event.subscriptionStatus ?? '(unchanged)'}, ` +
        `cancelAtPeriodEnd=${event.cancelAtPeriodEnd ?? '(unchanged)'}, ` +
        `currentPeriodEnd=${event.currentPeriodEnd?.toISOString() ?? '(unchanged)'}, ` +
        `cancelAt=${event.cancelAt?.toISOString() ?? '(none)'}`,
    );

    await this.subscriptionRepo.update(
      { providerCustomerId: event.providerCustomerId },
      {
        ...(event.plan && { plan: event.plan }),
        ...(event.subscriptionStatus && { status: event.subscriptionStatus }),
        ...(event.currentPeriodStart && { currentPeriodStart: event.currentPeriodStart }),
        ...(event.currentPeriodEnd && { currentPeriodEnd: event.currentPeriodEnd }),
        ...(event.cancelAtPeriodEnd !== undefined && {
          cancelAtPeriodEnd: event.cancelAtPeriodEnd,
        }),
      },
    );
  }

  private async onSubscriptionCancelled(event: InternalBillingEvent): Promise<void> {
    if (!event.providerCustomerId) return;

    await this.subscriptionRepo.update(
      { providerCustomerId: event.providerCustomerId },
      { status: 'cancelled', plan: 'free', cancelAtPeriodEnd: false },
    );
  }

  private async onPaymentSucceeded(event: InternalBillingEvent): Promise<void> {
    if (!event.providerPaymentId || !event.providerCustomerId) return;

    const sub = await this.subscriptionRepo.findOneBy({
      providerCustomerId: event.providerCustomerId,
    });
    if (!sub) {
      this.logger.warn(`No subscription found for provider customer ${event.providerCustomerId}`);
      return;
    }

    try {
      await this.paymentRepo.upsert(
        {
          userId: sub.userId,
          provider: event.provider,
          providerPaymentId: event.providerPaymentId,
          providerTransactionReference: event.providerTransactionReference,
          paymentMethod: event.paymentMethod,
          amount: event.amountMinorUnits ?? 0,
          currency: event.currency ?? 'GBP',
          status: 'succeeded',
        },
        { conflictPaths: ['providerPaymentId'] },
      );
    } catch (err) {
      // A Clerk-triggered account erasure (UserService.deleteByClerkId) can
      // hard-delete this user — and cascade-delete `sub` with it — in the
      // narrow window between the findOneBy above and this insert, since
      // they run on independent DB connections with no shared lock. When
      // that happens this insert violates payments' FK on user_id. That's
      // not a bug to retry: the account is gone, so there is nothing left to
      // record this payment against, and Stripe retrying this webhook
      // forever would never succeed. Swallow and log rather than 500.
      this.logger.warn(
        `Payment record skipped — account likely deleted concurrently (provider customer ${event.providerCustomerId}, ${err instanceof Error ? err.name : 'UnknownError'})`,
      );
    }
  }

  private async onPaymentFailed(event: InternalBillingEvent): Promise<void> {
    if (!event.providerCustomerId) return;

    await this.subscriptionRepo.update(
      { providerCustomerId: event.providerCustomerId },
      { status: 'past_due' },
    );

    this.logger.warn(`Payment failed for provider customer ${event.providerCustomerId}`);
    // TODO: send renewal prompt via NotificationService
  }
}

// ── Effective plan resolution ────────────────────────────────────────────────
// A subscription's *stored* `plan` can lag behind reality: Stripe reports
// payment failures and unconfirmed setups via `status`, not by changing
// `plan` (see onPaymentFailed above, which only ever sets `status`). Without
// this, a user whose card fails keeps unlimited paid access indefinitely,
// since PLAN_LIMITS would still be looked up under 'pro'/'student'.
//
// Rules (plan, status) → effective plan:
//   - no subscription row, or plan === 'free'        → free
//   - pro/student + active                           → pro/student
//   - pro/student + trialing                         → pro/student (retained)
//   - pro/student + past_due                         → free (until resolved)
//   - pro/student + incomplete                        → free (until resolved)
//   - pro/student + cancelled                        → free
//   - active + cancelAtPeriodEnd: true                → pro/student — Stripe
//     keeps `status: 'active'` for the rest of the paid period even after a
//     cancellation is scheduled, only moving away from 'active' once the
//     subscription is actually deleted, so this falls out of the
//     `status === 'active'` case with no separate check needed.
//
// This never mutates the stored row — it's a pure read-time projection, so
// getSubscription() (used for dashboard display) keeps returning the real,
// unmodified plan/status untouched by this logic.
// ── Usage counter shaping ────────────────────────────────────────────────────
// Infinity is an internal PLAN_LIMITS sentinel for "unlimited" — it must
// never be serialized to JSON (JSON.stringify(Infinity) === 'null' anyway,
// but relying on that would be an accident, not a contract). null is the
// explicit, documented "unlimited" value on the wire.
function toUsageCounter(used: number, limit: number): UsageCounter {
  if (limit === Infinity) return { used, limit: null, remaining: null };
  return { used, limit, remaining: Math.max(limit - used, 0) };
}

function resolveEffectivePlan(sub: Pick<SubscriptionEntity, 'plan' | 'status'> | null): Plan {
  if (!sub || sub.plan === 'free') return 'free';

  switch (sub.status) {
    case 'active':
    case 'trialing':
      return sub.plan;
    case 'past_due':
    case 'incomplete':
    case 'cancelled':
    default:
      return 'free';
  }
}
