import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UserController } from './user.controller';
import { UserService } from './user.service';
import { UserEntity } from '../../entities/user.entity';
import { ProfileEntity } from '../../entities/profile.entity';
import { CvEntity } from '../../entities/cv.entity';
import { CoverLetterEntity } from '../../entities/cover-letter.entity';
import { SubscriptionEntity } from '../../entities/subscription.entity';
import { StripePaymentProvider } from '../billing/providers/stripe.provider';

@Module({
  // CvEntity/CoverLetterEntity/SubscriptionEntity are only needed here to
  // read state before account erasure (UserService.deleteByClerkId) — the
  // relational deletes themselves go through the injected
  // DataSource/EntityManager directly against entity classes, which
  // doesn't require a per-module repository registration.
  imports: [
    TypeOrmModule.forFeature([
      UserEntity,
      ProfileEntity,
      CvEntity,
      CoverLetterEntity,
      SubscriptionEntity,
    ]),
  ],
  controllers: [UserController],
  // StripePaymentProvider is declared directly here rather than imported
  // via BillingModule: BillingModule already imports UserModule (for
  // UserService), so the reverse import would be circular. It's a
  // stateless wrapper around the Stripe SDK (constructor only depends on
  // ConfigService), so a second independent instance here is harmless —
  // the same pattern already used for e.g. S3Client, which several
  // services (CvService, ParsingService, UserService) each construct
  // independently rather than sharing one centrally.
  providers: [UserService, StripePaymentProvider],
  exports: [UserService],
})
export class UserModule {}
