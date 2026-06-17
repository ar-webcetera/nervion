import { HttpException, HttpStatus, Inject, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CompletedPart,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
  UploadPartCopyCommand,
} from '@aws-sdk/client-s3';
import { createHash, createHmac } from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import { stat } from 'fs/promises';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { S3_CLIENT } from './storage.constants';

export interface StorageObjectStream {
  body: Readable;
  contentType: string;
  contentLength: number;
  contentRange: string | null;
  etag: string | null;
  lastModified: Date | null;
}

export interface StorageObjectStreamOptions {
  maxChunkSize?: number;
}

export interface StoragePresignedUrl {
  url: string;
  expiresAt: Date;
}

interface StorageResolvedRange {
  requestRange: string;
  contentRange: string;
  contentLength: number;
}

interface StorageParsedRange {
  start: number;
  end: number;
}

const SINGLE_COPY_LIMIT_BYTES = 5 * 1024 * 1024 * 1024;
const MULTIPART_COPY_PART_SIZE_BYTES = 512 * 1024 * 1024;
const MULTIPART_UPLOAD_PART_SIZE_BYTES = 64 * 1024 * 1024;
const MULTIPART_UPLOAD_THRESHOLD_BYTES = 128 * 1024 * 1024;

@Injectable()
export class StorageService {
  constructor(
    @Inject(S3_CLIENT) private readonly s3Client: S3Client,
    private readonly configService: ConfigService,
  ) {}

  getClient(): S3Client {
    return this.s3Client;
  }

  getBucketId(): string {
    const bucketId = this.configService.get<string>('AWS_BUCKET_ID');
    if (!bucketId) {
      throw new InternalServerErrorException('AWS_BUCKET_ID не задан');
    }
    return bucketId;
  }

  async createMultipartUpload(key: string, contentType: string): Promise<string> {
    const result = await this.s3Client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.getBucketId(),
        Key: key,
        ContentType: contentType,
      }),
    );

    if (!result.UploadId) {
      throw new InternalServerErrorException('S3 не вернул uploadId');
    }

    return result.UploadId;
  }

  async completeMultipartUpload(key: string, uploadId: string, parts: CompletedPart[]): Promise<void> {
    await this.s3Client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.getBucketId(),
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts,
        },
      }),
    );
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    await this.s3Client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.getBucketId(),
        Key: key,
        UploadId: uploadId,
      }),
    );
  }

  async uploadObject(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.getBucketId(),
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async uploadFileObject(key: string, filePath: string, contentType: string): Promise<number> {
    const fileStats = await stat(filePath);
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.getBucketId(),
        Key: key,
        Body: createReadStream(filePath),
        ContentLength: fileStats.size,
        ContentType: contentType,
      }),
    );

    return fileStats.size;
  }

  async uploadLargeFileObject(key: string, filePath: string, contentType: string): Promise<number> {
    const fileStats = await stat(filePath);
    if (fileStats.size <= MULTIPART_UPLOAD_THRESHOLD_BYTES) {
      return this.uploadFileObject(key, filePath, contentType);
    }

    const uploadId = await this.createMultipartUpload(key, contentType);
    const parts: CompletedPart[] = [];
    let completed = false;

    try {
      for (let start = 0, partNumber = 1; start < fileStats.size; start += MULTIPART_UPLOAD_PART_SIZE_BYTES, partNumber += 1) {
        const end = Math.min(start + MULTIPART_UPLOAD_PART_SIZE_BYTES, fileStats.size) - 1;
        const result = await this.s3Client.send(
          new UploadPartCommand({
            Bucket: this.getBucketId(),
            Key: key,
            UploadId: uploadId,
            PartNumber: partNumber,
            Body: createReadStream(filePath, { start, end }),
            ContentLength: end - start + 1,
          }),
        );

        parts.push({
          PartNumber: partNumber,
          ETag: result.ETag,
        });
      }

      await this.completeMultipartUpload(key, uploadId, parts);
      completed = true;
      return fileStats.size;
    } finally {
      if (!completed) {
        await this.abortMultipartUpload(key, uploadId).catch(() => {});
      }
    }
  }

  async downloadObjectToFile(key: string, filePath: string): Promise<void> {
    const stream = await this.getObjectStream(key);
    await pipeline(stream.body, createWriteStream(filePath));
  }

  async getObjectText(key: string): Promise<string> {
    const stream = await this.getObjectStream(key);
    const chunks: Buffer[] = [];

    for await (const chunk of stream.body as AsyncIterable<Buffer | Uint8Array | string>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    return Buffer.concat(chunks).toString('utf8');
  }

  async createFolderPlaceholder(key: string): Promise<void> {
    await this.uploadObject(this.normalizeFolderPlaceholderKey(key), Buffer.from(''), 'application/x-directory');
  }

  async deleteObject(key: string | null): Promise<void> {
    if (!key) return;
    await this.s3Client.send(new DeleteObjectCommand({ Bucket: this.getBucketId(), Key: key }));
  }

  async deleteObjectsByPrefix(prefix: string | null): Promise<void> {
    if (!prefix) return;

    const bucket = this.getBucketId();
    let continuationToken: string | undefined;
    do {
      const listed = await this.s3Client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      const objects = (listed.Contents ?? [])
        .map((object) => object.Key)
        .filter((key): key is string => Boolean(key))
        .map((Key) => ({ Key }));

      if (objects.length > 0) {
        await this.s3Client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: {
              Objects: objects,
              Quiet: true,
            },
          }),
        );
      }

      continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (continuationToken);
  }

  async moveObject(sourceKey: string, targetKey: string): Promise<void> {
    if (sourceKey === targetKey) return;
    await this.copyObject(sourceKey, targetKey);
    await this.deleteObject(sourceKey);
  }

  async listObjectKeysByPrefix(prefix: string): Promise<string[]> {
    const bucket = this.getBucketId();
    const keys: string[] = [];
    let continuationToken: string | undefined;
    do {
      const listed = await this.s3Client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      keys.push(...(listed.Contents ?? []).map((object) => object.Key).filter((key): key is string => Boolean(key)));
      continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (continuationToken);

    return keys;
  }

  async getObjectStream(key: string, range?: string, options: StorageObjectStreamOptions = {}): Promise<StorageObjectStream> {
    const maxChunkSize = this.normalizeMaxChunkSize(options.maxChunkSize);
    if (maxChunkSize) {
      return this.getChunkedObjectStream(key, range, maxChunkSize);
    }

    const result = await this.s3Client.send(
      new GetObjectCommand({
        Bucket: this.getBucketId(),
        Key: key,
        Range: range,
      }),
    );

    if (!result.Body || !(result.Body instanceof Readable)) {
      throw new NotFoundException('Файл не найден');
    }

    return {
      body: result.Body,
      contentType: result.ContentType ?? 'application/octet-stream',
      contentLength: result.ContentLength ?? 0,
      contentRange: result.ContentRange ?? null,
      etag: result.ETag?.replace(/"/g, '') ?? null,
      lastModified: result.LastModified ?? null,
    };
  }

  private async getChunkedObjectStream(
    key: string,
    range: string | undefined,
    maxChunkSize: number,
  ): Promise<StorageObjectStream> {
    const bucket = this.getBucketId();
    const head = await this.s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    const totalLength = head.ContentLength;
    if (totalLength === undefined) {
      throw new InternalServerErrorException('S3 не вернул размер файла');
    }

    if (totalLength <= 0) {
      return this.getObjectStream(key, range);
    }

    const resolvedRange = this.resolveObjectRange(range, totalLength, maxChunkSize);
    const result = await this.s3Client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        Range: resolvedRange.requestRange,
      }),
    );

    if (!result.Body || !(result.Body instanceof Readable)) {
      throw new NotFoundException('Файл не найден');
    }

    return {
      body: result.Body,
      contentType: result.ContentType ?? head.ContentType ?? 'application/octet-stream',
      contentLength: resolvedRange.contentLength,
      contentRange: resolvedRange.contentRange,
      etag: (result.ETag ?? head.ETag)?.replace(/"/g, '') ?? null,
      lastModified: result.LastModified ?? head.LastModified ?? null,
    };
  }

  private normalizeMaxChunkSize(value: number | undefined): number | null {
    if (value === undefined) {
      return null;
    }

    const normalized = Math.floor(value);
    return normalized > 0 ? normalized : null;
  }

  private resolveObjectRange(range: string | undefined, totalLength: number, maxChunkSize: number): StorageResolvedRange {
    const parsedRange = this.parseObjectRange(range, totalLength);
    const start = parsedRange?.start ?? 0;
    const requestedEnd = parsedRange?.end ?? totalLength - 1;
    const end = Math.min(requestedEnd, start + maxChunkSize - 1, totalLength - 1);

    if (start > end) {
      throw new HttpException('Запрошенный диапазон вне размера файла', HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE);
    }

    return {
      requestRange: `bytes=${start}-${end}`,
      contentRange: `bytes ${start}-${end}/${totalLength}`,
      contentLength: end - start + 1,
    };
  }

  private parseObjectRange(range: string | undefined, totalLength: number): StorageParsedRange | null {
    if (!range) {
      return null;
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!match) {
      throw new HttpException('Некорректный Range-заголовок', HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE);
    }

    const [, rawStart, rawEnd] = match;
    if (!rawStart && !rawEnd) {
      throw new HttpException('Некорректный Range-заголовок', HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE);
    }

    if (!rawStart) {
      const suffixLength = Number(rawEnd);
      if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
        throw new HttpException('Некорректный Range-заголовок', HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE);
      }

      return {
        start: Math.max(totalLength - suffixLength, 0),
        end: totalLength - 1,
      };
    }

    const start = Number(rawStart);
    const end = rawEnd ? Number(rawEnd) : totalLength - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= totalLength) {
      throw new HttpException('Запрошенный диапазон вне размера файла', HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE);
    }

    return {
      start,
      end: Math.min(end, totalLength - 1),
    };
  }

  async objectExists(key: string): Promise<boolean> {
    try {
      await this.s3Client.send(new HeadObjectCommand({ Bucket: this.getBucketId(), Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  createUploadPartUrl(key: string, uploadId: string, partNumber: number, expiresSeconds = 900): StoragePresignedUrl {
    return this.createPresignedS3Url({
      method: 'PUT',
      key,
      expiresSeconds,
      query: {
        partNumber: String(partNumber),
        uploadId,
      },
    });
  }

  createDownloadUrl(key: string, expiresSeconds = 300): StoragePresignedUrl {
    return this.createPresignedS3Url({
      method: 'GET',
      key,
      expiresSeconds,
      query: {},
    });
  }

  private async copyObject(sourceKey: string, targetKey: string): Promise<void> {
    const bucket = this.getBucketId();
    const source = await this.s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: sourceKey }));
    const contentLength = source.ContentLength;
    if (contentLength === undefined) {
      throw new InternalServerErrorException('S3 не вернул размер копируемого объекта');
    }

    if (contentLength <= SINGLE_COPY_LIMIT_BYTES) {
      await this.s3Client.send(
        new CopyObjectCommand({
          Bucket: bucket,
          Key: targetKey,
          CopySource: this.buildCopySource(sourceKey),
          MetadataDirective: 'COPY',
        }),
      );
      return;
    }

    const uploadId = await this.createMultipartUpload(targetKey, source.ContentType ?? 'application/octet-stream');
    const parts: CompletedPart[] = [];
    let completed = false;

    try {
      for (let start = 0, partNumber = 1; start < contentLength; start += MULTIPART_COPY_PART_SIZE_BYTES, partNumber += 1) {
        const end = Math.min(start + MULTIPART_COPY_PART_SIZE_BYTES, contentLength) - 1;
        const result = await this.s3Client.send(
          new UploadPartCopyCommand({
            Bucket: bucket,
            Key: targetKey,
            UploadId: uploadId,
            PartNumber: partNumber,
            CopySource: this.buildCopySource(sourceKey),
            CopySourceRange: `bytes=${start}-${end}`,
          }),
        );
        parts.push({
          PartNumber: partNumber,
          ETag: result.CopyPartResult?.ETag,
        });
      }

      await this.completeMultipartUpload(targetKey, uploadId, parts);
      completed = true;
    } finally {
      if (!completed) {
        await this.abortMultipartUpload(targetKey, uploadId).catch(() => {});
      }
    }
  }

  private createPresignedS3Url(params: {
    method: 'GET' | 'PUT';
    key: string;
    expiresSeconds: number;
    query: Record<string, string>;
  }): StoragePresignedUrl {
    const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID') || '';
    const secretAccessKey = this.configService.get<string>('AWS_SECRET_ACCESS_KEY') || '';
    const region = this.configService.get<string>('AWS_REGION', 'us-east-1') || 'us-east-1';
    const endpoint = new URL(
      this.configService.get<string>('AWS_ENDPOINT', 'https://s3.timeweb.cloud') || 'https://s3.timeweb.cloud',
    );
    const now = new Date();
    const amzDate = this.formatAmzDate(now);
    const dateStamp = amzDate.slice(0, 8);
    const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
    const signedHeaders = 'host';
    const bucket = this.getBucketId();
    const canonicalUri = this.buildCanonicalUri(endpoint.pathname, bucket, params.key);
    const expiresAt = new Date(now.getTime() + params.expiresSeconds * 1000);

    const query: Record<string, string> = {
      ...params.query,
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Content-Sha256': 'UNSIGNED-PAYLOAD',
      'X-Amz-Credential': `${accessKeyId}/${credentialScope}`,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': String(params.expiresSeconds),
      'X-Amz-SignedHeaders': signedHeaders,
    };
    const canonicalQuery = this.buildCanonicalQuery(query);
    const canonicalHeaders = `host:${endpoint.host}\n`;
    const canonicalRequest = [
      params.method,
      canonicalUri,
      canonicalQuery,
      canonicalHeaders,
      signedHeaders,
      'UNSIGNED-PAYLOAD',
    ].join('\n');
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, this.sha256Hex(canonicalRequest)].join('\n');
    const signature = this.hmacHex(this.getSigningKey(secretAccessKey, dateStamp, region), stringToSign);
    const finalQuery = `${canonicalQuery}&X-Amz-Signature=${signature}`;

    return {
      url: `${endpoint.origin}${canonicalUri}?${finalQuery}`,
      expiresAt,
    };
  }

  private buildCanonicalUri(basePath: string, bucket: string, key: string): string {
    const normalizedBasePath = basePath && basePath !== '/' ? basePath.replace(/\/+$/g, '') : '';
    const encodedKey = key
      .split('/')
      .map((segment) => this.rfc3986Encode(segment))
      .join('/');

    return `${normalizedBasePath}/${this.rfc3986Encode(bucket)}/${encodedKey}`;
  }

  private buildCopySource(key: string): string {
    const encodedKey = key
      .split('/')
      .map((segment) => this.rfc3986Encode(segment))
      .join('/');

    return `${this.rfc3986Encode(this.getBucketId())}/${encodedKey}`;
  }

  private buildCanonicalQuery(query: Record<string, string>): string {
    return Object.entries(query)
      .map(([key, value]) => [this.rfc3986Encode(key), this.rfc3986Encode(value)] as const)
      .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
        if (leftKey === rightKey) return this.compareCanonicalQueryPart(leftValue, rightValue);
        return this.compareCanonicalQueryPart(leftKey, rightKey);
      })
      .map(([key, value]) => `${key}=${value}`)
      .join('&');
  }

  private compareCanonicalQueryPart(left: string, right: string): number {
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  }

  private normalizeFolderPlaceholderKey(key: string): string {
    return key.endsWith('/') ? key : `${key}/`;
  }

  private formatAmzDate(date: Date): string {
    return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  }

  private rfc3986Encode(value: string): string {
    return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  }

  private sha256Hex(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private hmacBuffer(key: Buffer | string, value: string): Buffer {
    return createHmac('sha256', key).update(value).digest();
  }

  private hmacHex(key: Buffer | string, value: string): string {
    return createHmac('sha256', key).update(value).digest('hex');
  }

  private getSigningKey(secretAccessKey: string, dateStamp: string, region: string): Buffer {
    const dateKey = this.hmacBuffer(`AWS4${secretAccessKey}`, dateStamp);
    const dateRegionKey = this.hmacBuffer(dateKey, region);
    const dateRegionServiceKey = this.hmacBuffer(dateRegionKey, 's3');
    return this.hmacBuffer(dateRegionServiceKey, 'aws4_request');
  }
}
