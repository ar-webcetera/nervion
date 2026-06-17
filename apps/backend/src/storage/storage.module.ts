import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';
import { S3_CLIENT } from './storage.constants';
import { StorageService } from './storage.service';

@Module({
  providers: [
    StorageService,
    {
      provide: S3_CLIENT,
      useFactory: (configService: ConfigService) => {
        return new S3Client({
          endpoint: configService.get<string>('AWS_ENDPOINT', 'https://s3.timeweb.cloud'),
          region: configService.get<string>('AWS_REGION', 'us-east-1'),
          credentials: {
            accessKeyId: configService.get<string>('AWS_ACCESS_KEY_ID') || '',
            secretAccessKey: configService.get<string>('AWS_SECRET_ACCESS_KEY') || '',
          },
          forcePathStyle: true,
        });
      },
      inject: [ConfigService],
    },
  ],
  exports: [StorageService, S3_CLIENT],
})
export class StorageModule {}
