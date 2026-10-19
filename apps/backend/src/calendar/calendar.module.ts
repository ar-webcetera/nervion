import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { Users } from '../users/entities/users.entity';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { CalendarEventEntity } from './entities/calendar-event.entity';
import { CalendarEventParticipant } from './entities/calendar-event-participant.entity';
import { CalendarEventReminder } from './entities/calendar-event-reminder.entity';

@Module({
  imports: [
    AuthModule,
    NotificationsModule,
    TypeOrmModule.forFeature([CalendarEventEntity, CalendarEventParticipant, CalendarEventReminder, Users]),
  ],
  controllers: [CalendarController],
  providers: [CalendarService],
})
export class CalendarModule {}
