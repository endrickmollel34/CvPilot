import 'reflect-metadata';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env before process.env is read below — TypeORM CLI does not load it automatically
config({ path: resolve(__dirname, '../.env') });

import { DataSource } from 'typeorm';

import { UserEntity } from './entities/user.entity';
import { ProfileEntity } from './entities/profile.entity';
import { CvEntity } from './entities/cv.entity';
import { AnalysisEntity } from './entities/analysis.entity';
import { AtsReportEntity } from './entities/ats-report.entity';
import { CoverLetterEntity } from './entities/cover-letter.entity';
import { SubscriptionEntity } from './entities/subscription.entity';
import { PaymentEntity } from './entities/payment.entity';
import { AuditLogEntity } from './entities/audit-log.entity';
import { NotificationEntity } from './entities/notification.entity';
import { TailoringEntity } from './entities/tailoring.entity';

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env['DATABASE_URL'],
  entities: [
    UserEntity,
    ProfileEntity,
    CvEntity,
    AnalysisEntity,
    AtsReportEntity,
    CoverLetterEntity,
    SubscriptionEntity,
    PaymentEntity,
    AuditLogEntity,
    NotificationEntity,
    TailoringEntity,
  ],
  migrations: ['dist/migrations/*.js'],
  synchronize: false,
  ssl: process.env['NODE_ENV'] === 'production' ? { rejectUnauthorized: false } : false,
});
