import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { StorageService } from './storage.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { FilesService } from '../files/files.service';

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

  it('возвращает 404 вместо ошибки сервера при отсутствии объекта в S3', async () => {
    const send = jest.fn().mockRejectedValue(new NoSuchKey({ message: 'Not found', $metadata: { httpStatusCode: 404 } }));
    const service = createService({ send } as Partial<S3Client> as S3Client);

    await expect(service.getObjectStream('missing.txt')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('возвращает 404 при отсутствии объекта на HEAD chunked-запроса', async () => {
    const send = jest
      .fn()
      .mockRejectedValue(
        new S3ServiceException({ name: 'NotFound', message: 'Not found', $fault: 'client', $metadata: { httpStatusCode: 404 } }),
      );
    const service = createService({ send } as Partial<S3Client> as S3Client);

    await expect(service.getObjectStream('missing.mp4', undefined, { maxChunkSize: 1024 })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(send.mock.calls[0][0]).toBeInstanceOf(HeadObjectCommand);
  });

  it('возвращает 404 если объект удалён между HEAD и GET chunked-запроса', async () => {
    const send = jest
      .fn()
      .mockResolvedValueOnce({ ContentLength: 2048 })
      .mockRejectedValueOnce(new NoSuchKey({ message: 'Not found', $metadata: { httpStatusCode: 404 } }));
    const service = createService({ send } as Partial<S3Client> as S3Client);

    await expect(service.getObjectStream('deleted.mp4', undefined, { maxChunkSize: 1024 })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(send.mock.calls[1][0]).toBeInstanceOf(GetObjectCommand);
  });

  it('не скрывает сбои S3 за ошибкой отсутствующего файла', async () => {
    const failure = new S3ServiceException({
      name: 'InternalError',
      message: 'Storage unavailable',
      $fault: 'server',
      $metadata: { httpStatusCode: 500 },
    });
    const send = jest.fn().mockRejectedValue(failure);
    const service = createService({ send } as Partial<S3Client> as S3Client);

    await expect(service.getObjectStream('file.txt')).rejects.toBe(failure);
  });

  describe('изоляция пространств', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const prefix = `tenants/${tenantId}/`;
    const createTenantService = (readOnly = false) => {
      const send = jest.fn().mockResolvedValue({});
      const context = {
        require: jest.fn().mockReturnValue({ tenant: { id: tenantId, storageNamespace: prefix, readOnly } }),
      } as Partial<TenantContextService> as TenantContextService;
      const service = new StorageService(
        { send } as Partial<S3Client> as S3Client,
        new ConfigService({ TENANCY_ENABLED: 'true', AWS_BUCKET_ID: 'test', AWS_ENDPOINT: 'https://s3.example.com' }),
        context,
      );
      return { service, send, context };
    };

    it('записывает объекты только в приватный namespace текущего клиента', async () => {
      const { service, send } = createTenantService();
      await service.uploadObject('tasks/1/file.txt', Buffer.from('text'), 'text/plain', true);
      const command = send.mock.calls[0][0] as PutObjectCommand;
      expect(command.input.Key).toBe(`${prefix}tasks/1/file.txt`);
      expect(command.input.ACL).toBe('private');
    });

    it('не подписывает и не проверяет существование файла другого клиента', async () => {
      const { service, send } = createTenantService();
      const foreign = 'tenants/22222222-2222-4222-8222-222222222222/tasks/1/file.txt';
      expect(() => service.createDownloadUrl(foreign)).toThrow('другому пространству');
      await expect(service.objectExists(foreign)).rejects.toThrow('другому пространству');
      await expect(service.moveObject('tasks/1/file.txt', foreign)).rejects.toThrow('другому пространству');
      expect(send).not.toHaveBeenCalled();
    });

    it('raw-файл другого пространства возвращает 404 без поиска вне своего namespace', async () => {
      const { service, send } = createTenantService();
      send.mockRejectedValueOnce(new NoSuchKey({ message: 'Not found', $metadata: { httpStatusCode: 404 } }));
      const files = new FilesService(service);

      await expect(files.getRawFile('preprod-smoke/isolation.txt')).rejects.toMatchObject({ status: 404 });
      expect(send).toHaveBeenCalledTimes(1);
      expect((send.mock.calls[0][0] as GetObjectCommand).input.Key).toBe(`${prefix}preprod-smoke/isolation.txt`);
    });

    it('подписывает multipart и чтение внутри текущего namespace', () => {
      const { service } = createTenantService();
      expect(new URL(service.createDownloadUrl('a.txt').url).pathname).toBe(`/test/${prefix}a.txt`);
      expect(new URL(service.createUploadPartUrl('a.txt', 'upload', 1).url).pathname).toBe(`/test/${prefix}a.txt`);
    });

    it('список и массовое удаление не выходят за tenant prefix', async () => {
      const { service, send } = createTenantService();
      send.mockResolvedValueOnce({ Contents: [{ Key: `${prefix}tasks/a.txt` }] });
      expect(await service.listObjectKeysByPrefix('tasks/')).toEqual(['tasks/a.txt']);
      expect((send.mock.calls[0][0] as ListObjectsV2Command).input.Prefix).toBe(`${prefix}tasks/`);
      send.mockResolvedValueOnce({ Contents: [{ Key: `${prefix}tasks/a.txt` }] }).mockResolvedValueOnce({});
      await service.deleteObjectsByPrefix('tasks/');
      expect((send.mock.calls[2][0] as DeleteObjectsCommand).input.Delete?.Objects).toEqual([{ Key: `${prefix}tasks/a.txt` }]);
    });

    it('не использует глобальные ключи при отсутствии контекста', async () => {
      const { service, send, context } = createTenantService();
      jest.spyOn(context, 'require').mockImplementation(() => {
        throw new Error('Нет контекста');
      });
      await expect(service.headObject('old-file.txt')).rejects.toThrow('Нет контекста');
      expect(send).not.toHaveBeenCalled();
    });

    it('блокирует upload и presigned PUT в режиме только чтения', async () => {
      const { service, send } = createTenantService(true);
      await expect(service.uploadObject('a', Buffer.from('a'), 'text/plain')).rejects.toThrow('только для чтения');
      expect(() => service.createUploadPartUrl('a', 'upload', 1)).toThrow('только для чтения');
      expect(send).not.toHaveBeenCalled();
    });
  });
});
