import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { SmtpWorkerModule } from './smtp-worker.module';
import { SmtpServerService } from './mailbox/smtp/smtp-server.service';

// Отдельный процесс: SMTP-приёмник входящей почты (отдельная точка входа SMTP-приёмника)
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(SmtpWorkerModule);
  const smtpServer = app.get(SmtpServerService);

  smtpServer.listen();

  const shutdown = async () => {
    await smtpServer.close();
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

bootstrap().catch((error) => {
  new Logger('SmtpWorker').error(`Не удалось запустить SMTP-воркер: ${error instanceof Error ? error.stack : error}`);
  process.exit(1);
});
