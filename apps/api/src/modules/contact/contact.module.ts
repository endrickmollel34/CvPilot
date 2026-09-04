import { Module } from '@nestjs/common';

import { NotificationModule } from '../notification/notification.module';
import { ContactController } from './contact.controller';
import { ContactService } from './contact.service';

@Module({
  imports: [NotificationModule],
  controllers: [ContactController],
  providers: [ContactService],
})
export class ContactModule {}
