import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { StripePaymentProvider } from './providers/stripe.provider';
import { SubscriptionEntity } from '../../entities/subscription.entity';
import { PaymentEntity } from '../../entities/payment.entity';
import { AnalysisEntity } from '../../entities/analysis.entity';
import { UserModule } from '../user/user.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SubscriptionEntity, PaymentEntity, AnalysisEntity]),
    UserModule,
  ],
  controllers: [BillingController],
  providers: [BillingService, StripePaymentProvider],
  exports: [BillingService],
})
export class BillingModule {}
