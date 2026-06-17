import { MailerModule } from '@nestjs-modules/mailer';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';

const DEFAULT_MAIL_PORT = 587;

const parseMailPort = (value?: string): number => {
  const parsedPort = Number(value);

  if (Number.isFinite(parsedPort) && parsedPort > 0) {
    return parsedPort;
  }

  return DEFAULT_MAIL_PORT;
};

const parseOptionalBoolean = (value?: string): boolean | null => {
  const normalized = value?.trim().toLowerCase();

  if (normalized === 'true' || normalized === '1') {
    return true;
  }

  if (normalized === 'false' || normalized === '0') {
    return false;
  }

  return null;
};

@Module({
  imports: [
    MailerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const port = parseMailPort(config.get<string>('MAIL_PORT'));
        const mailUser = config.get<string>('MAIL_USER');
        const mailPass = config.get<string>('MAIL_PASS');
        const explicitSecure = parseOptionalBoolean(config.get<string>('MAIL_SECURE'));

        return {
          transport: {
            host: config.get<string>('MAIL_HOST'),
            port,
            secure: explicitSecure ?? port === 465,
            auth:
              mailUser && mailPass
                ? {
                    user: mailUser,
                    pass: mailPass,
                  }
                : undefined,
          },
          defaults: {
            from: config.get<string>('MAIL_FROM') || mailUser,
          },
        };
      },
    }),
  ],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
