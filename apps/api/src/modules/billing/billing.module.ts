import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { StripePaymentProvider } from './providers/stripe.provider';
import { SubscriptionEntity } from '../../entities/subscription.entity';
import { PaymentEntity } from '../../entities/payment.entity';
import { AnalysisEntity } from '../../entities/analysis.entity';
import { CoverLetterEntity } from '../../entities/cover-letter.entity';
import { TailoringEntity } from '../../entities/tailoring.entity';
import { CvEntity } from '../../entities/cv.entity';
import { UserModule } from '../user/user.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SubscriptionEntity,
      PaymentEntity,
      AnalysisEntity,
      CoverLetterEntity,
      TailoringEntity,
      CvEntity,
    ]),
    UserModule,
  ],
  controllers: [BillingController],
  providers: [BillingService, StripePaymentProvider],
  exports: [BillingService],
})
export class BillingModule {}
