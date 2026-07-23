import { Injectable } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';

export interface NotificationMailOptions {
  notificationId?: number;
}

@Injectable()
export class MailService {
  constructor(private readonly mailerService: MailerService) {}

  async sendMail(to: string, subject: string, html: string, options: NotificationMailOptions = {}): Promise<void> {
    await this.mailerService.sendMail({
      to,
      subject,
      html,
      headers:
        options.notificationId === undefined
          ? undefined
          : {
              'X-Nervion-Notification-Id': String(options.notificationId),
            },
    });
  }
}
