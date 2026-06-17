import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { StorageService } from './storage.service';

describe('StorageService', () => {
  interface S3ObjectResponse {
    Body?: Readable;
    ContentLength?: number;
    ContentType?: string;
    ContentRange?: string;
    ETag?: string;
    LastModified?: Date;
  }

  type S3ObjectCommand = HeadObjectCommand | GetObjectCommand;

  const createService = (s3Client: S3Client = {} as S3Client, config: Record<string, string> = {}): StorageService => {
    const configService = new ConfigService({
      AWS_ACCESS_KEY_ID: 'AKIDEXAMPLE',
      AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      AWS_REGION: 'ru-1',
      AWS_ENDPOINT: 'https://hb.ru-msk.vkcloud-storage.ru',
      AWS_BUCKET_ID: 'webcetera',
      ...config,
    });

    return new StorageService(s3Client, configService);
  };

  it('сортирует query-параметры presigned URL по ASCII для SigV4', () => {
    const service = createService();
    const presigned = service.createUploadPartUrl('uploads/videos/video.mp4', 'upload-id', 1);
    const queryParts = new URL(presigned.url).search.slice(1).split('&');

    const algorithmIndex = queryParts.findIndex((part) => part.startsWith('X-Amz-Algorithm='));
    const partNumberIndex = queryParts.findIndex((part) => part.startsWith('partNumber='));
    const uploadIdIndex = queryParts.findIndex((part) => part.startsWith('uploadId='));

    expect(algorithmIndex).toBeGreaterThanOrEqual(0);
    expect(partNumberIndex).toBeGreaterThan(algorithmIndex);
    expect(uploadIdIndex).toBeGreaterThan(algorithmIndex);
  });

  it('ограничивает открытый range-запрос размером чанка', async () => {
    const sendMock = jest
      .fn<Promise<S3ObjectResponse>, [S3ObjectCommand]>()
      .mockResolvedValueOnce({
        ContentLength: 50 * 1024 * 1024,
        ContentType: 'video/mp4',
        ETag: '"head-etag"',
        LastModified: new Date('2026-05-11T08:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        Body: Readable.from(Buffer.alloc(0)),
        ContentLength: 8 * 1024 * 1024,
        ContentType: 'video/mp4',
        ContentRange: 'bytes 0-8388607/52428800',
        ETag: '"object-etag"',
        LastModified: new Date('2026-05-11T08:00:00.000Z'),
      });
    const service = createService({ send: sendMock } as Partial<S3Client> as S3Client);

    const stream = await service.getObjectStream('uploads/videos/video.mp4', 'bytes=0-', {
      maxChunkSize: 8 * 1024 * 1024,
    });
    const getCommand = sendMock.mock.calls[1][0] as GetObjectCommand;

    expect(getCommand.input.Range).toBe('bytes=0-8388607');
    expect(stream.contentLength).toBe(8 * 1024 * 1024);
    expect(stream.contentRange).toBe('bytes 0-8388607/52428800');
    expect(stream.etag).toBe('object-etag');
  });

  it('создаёт первый частичный range даже если браузер не прислал Range', async () => {
    const sendMock = jest
      .fn<Promise<S3ObjectResponse>, [S3ObjectCommand]>()
      .mockResolvedValueOnce({
        ContentLength: 20 * 1024 * 1024,
        ContentType: 'video/mp4',
      })
      .mockResolvedValueOnce({
        Body: Readable.from(Buffer.alloc(0)),
        ContentLength: 4 * 1024 * 1024,
        ContentType: 'video/mp4',
      });
    const service = createService({ send: sendMock } as Partial<S3Client> as S3Client);

    const stream = await service.getObjectStream('uploads/videos/video.mp4', undefined, {
      maxChunkSize: 4 * 1024 * 1024,
    });
    const getCommand = sendMock.mock.calls[1][0] as GetObjectCommand;

    expect(getCommand.input.Range).toBe('bytes=0-4194303');
    expect(stream.contentLength).toBe(4 * 1024 * 1024);
    expect(stream.contentRange).toBe('bytes 0-4194303/20971520');
  });
});
