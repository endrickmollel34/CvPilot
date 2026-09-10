import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { StripePaymentProvider } from './providers/stripe.provider';
import { SubscriptionEntity } from '../../entities/subscription.entity';
import { PaymentEntity } from '../../entities/payment.entity';
import { CvEntity } from '../../entities/cv.entity';
import { UserModule } from '../user/user.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SubscriptionEntity, PaymentEntity, CvEntity]),
    UserModule,
    AuditModule,
  ],
  controllers: [BillingController],
  providers: [BillingService, StripePaymentProvider],
  exports: [BillingService],
})
export class BillingModule {}
