import { Inject, Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { UnloadFileDto } from './dto/unload-file.dto';
import { CreateFolderDto } from './dto/create-folder.dto';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { GetFilesDto } from './dto/get-files.dto';
import { ConfigService } from '@nestjs/config';
import type { RawFileResponse } from './files.types';
import { S3_CLIENT } from '../storage/storage.constants';
import { DataSource } from 'typeorm';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { Projects } from '../projects/entities/project.entity';
import { Tasks } from '../tasks/entities/task.entity';
import { ROLES } from '../common/enums/roles.enum';

export interface FileMetadata {
  Key: string;
  LastModified: Date;
  ETag: string;
  Size: number;
  StorageClass: string;
}

@Injectable()
export class FilesService {
  private assertCrmAccess(key: string, allowCrm: boolean) {
    if (key.startsWith('crm/') && !allowCrm) throw new ForbiddenException('Файлы CRM доступны только администраторам');
  }
  constructor(
    @Inject(S3_CLIENT) private readonly s3Client: S3Client,
    private readonly configService: ConfigService,
    private readonly dataSource?: DataSource,
  ) {}

  private isAdmin(user: AuthenticatedUser | boolean): boolean {
    return typeof user === 'boolean' ? user : user.role === ROLES.admin;
  }

  private async assertProjectFileAccess(key: string, user: AuthenticatedUser | boolean): Promise<boolean> {
    const wikiMatch = key.match(/^tracker-project-wiki\/(\d+)(?:\/|$)/);
    const taskMatch = key.match(/^tracker-tasks\/(\d+)(?:\/|$)/);
    if (!wikiMatch && !taskMatch) return key.startsWith('crm/');
    if (!this.dataSource) return false;

    let project: Projects | null = null;
    if (wikiMatch) {
      project = await this.dataSource.getRepository(Projects).findOneBy({ id: Number(wikiMatch[1]) });
    } else if (taskMatch) {
      const task = await this.dataSource.getRepository(Tasks).findOne({
        where: { id: Number(taskMatch[1]) },
        relations: ['project'],
      });
      project = task?.project ?? null;
    }

    if (!project?.isPrivate) return false;
    if (typeof user === 'boolean' || project.ownerId !== user.id) {
      throw new NotFoundException('Файл не найден');
    }
    return true;
  }

  private sanitizeStorageName(value: string, fallback: string): string {
    const normalized = value.normalize('NFKC').trim();
    const sanitized = normalized
      .replace(/[\\/]+/g, '-')
      .replace(/\+/g, '-')
      .replace(/\s+/g, '-')
      .replace(/[^\p{L}\p{N}._()-]+/gu, '-')
      .replace(/-+/g, '-')
      .replace(/^[-._()]+|[-._()]+$/g, '');

    return sanitized || fallback;
  }

  private sanitizeFilename(originalName: string): string {
    const rawFileName = originalName.split(/[\\/]/).pop() || originalName;
    const dotIndex = rawFileName.lastIndexOf('.');

    if (dotIndex <= 0) {
      return this.sanitizeStorageName(rawFileName, 'file');
    }

    const name = rawFileName.slice(0, dotIndex);
    const extension = rawFileName.slice(dotIndex + 1);
    const safeName = this.sanitizeStorageName(name, 'file');
    const safeExtension = this.sanitizeStorageName(extension, 'bin').toLowerCase();

    return `${safeName}.${safeExtension}`;
  }

  async checkExistFile(bucketId: string, key: string) {
    try {
      const headCommand = new HeadObjectCommand({
        Bucket: bucketId,
        Key: key,
      });
      await this.s3Client.send(headCommand);
      return true;
    } catch {
      return false;
    }
  }
  private buildUniqueKey(prefix: string, filename: string, counter: number): string {
    if (counter === 0) return `${prefix}${filename}`;
    const dotIndex = filename.lastIndexOf('.');
    if (dotIndex <= 0) return `${prefix}${filename} (${counter})`;
    const name = filename.slice(0, dotIndex);
    const ext = filename.slice(dotIndex);
    return `${prefix}${name} (${counter})${ext}`;
  }

  async unloadFile(file: Express.Multer.File, unloadFileDto: UnloadFileDto, user: AuthenticatedUser | boolean = false) {
    const bucketId = this.configService.get('AWS_BUCKET_ID') as string;
    const { prefix } = unloadFileDto;
    this.assertCrmAccess(prefix, this.isAdmin(user));
    const isPrivate = await this.assertProjectFileAccess(prefix, user);

    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const filename = this.sanitizeFilename(originalName);

    let counter = 0;
    let key = this.buildUniqueKey(prefix, filename, counter);
    while (await this.checkExistFile(bucketId, key)) {
      counter++;
      key = this.buildUniqueKey(prefix, filename, counter);
    }

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: bucketId,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        ACL: prefix.startsWith('crm/') || isPrivate ? 'private' : 'public-read',
      }),
    );
    const head = await this.s3Client.send(new HeadObjectCommand({ Bucket: bucketId, Key: key }));

    const metadata: FileMetadata = {
      Key: key,
      LastModified: head.LastModified!,
      ETag: head.ETag!.replace(/"/g, ''),
      Size: head.ContentLength!,
      StorageClass: head.StorageClass ?? 'STANDARD',
    };

    return metadata;
  }

  async createFolder(createFolderDto: CreateFolderDto, user: AuthenticatedUser | boolean = false) {
    const bucketId = this.configService.get('AWS_BUCKET_ID') as string;
    const { prefix, folderName } = createFolderDto;
    const safeFolderName = this.sanitizeStorageName(folderName, 'folder');
    const key = `${prefix}${safeFolderName}/`;
    this.assertCrmAccess(key, this.isAdmin(user));
    const isPrivate = await this.assertProjectFileAccess(key, user);

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: bucketId,
        Key: key,
        Body: '',
        ACL: key.startsWith('crm/') || isPrivate ? 'private' : 'public-read',
      }),
    );

    return { key };
  }

  async getFileContent(key: string, user: AuthenticatedUser | boolean = false): Promise<string> {
    this.assertCrmAccess(key, this.isAdmin(user));
    await this.assertProjectFileAccess(key, user);
    const bucketId = this.configService.get('AWS_BUCKET_ID') as string;
    const response = await this.s3Client.send(new GetObjectCommand({ Bucket: bucketId, Key: key }));
    if (!response.Body) throw new NotFoundException('Файл не найден');
    return response.Body.transformToString('utf-8');
  }

  async getRawFile(key: string, user: AuthenticatedUser | boolean = false): Promise<RawFileResponse> {
    this.assertCrmAccess(key, this.isAdmin(user));
    const isPrivate = await this.assertProjectFileAccess(key, user);
    const bucketId = this.configService.get('AWS_BUCKET_ID') as string;
    const response = await this.s3Client.send(new GetObjectCommand({ Bucket: bucketId, Key: key }));

    if (!response.Body) {
      throw new NotFoundException('Файл не найден');
    }

    return {
      body: await response.Body.transformToByteArray(),
      contentType: response.ContentType ?? 'application/octet-stream',
      contentLength: response.ContentLength,
      etag: response.ETag?.replace(/"/g, ''),
      lastModified: response.LastModified,
      isPrivate: key.startsWith('crm/') || isPrivate,
    };
  }

  async putFileContent(key: string, content: string, user: AuthenticatedUser | boolean = false): Promise<void> {
    this.assertCrmAccess(key, this.isAdmin(user));
    const isPrivate = await this.assertProjectFileAccess(key, user);
    const bucketId = this.configService.get('AWS_BUCKET_ID') as string;
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: bucketId,
        Key: key,
        Body: content,
        ContentType: 'text/markdown; charset=utf-8',
        ACL: key.startsWith('crm/') || isPrivate ? 'private' : 'public-read',
      }),
    );
  }

  async deleteFile(key: string, user: AuthenticatedUser | boolean = false): Promise<void> {
    this.assertCrmAccess(key, this.isAdmin(user));
    await this.assertProjectFileAccess(key, user);
    const bucketId = this.configService.get('AWS_BUCKET_ID') as string;
    await this.s3Client.send(new DeleteObjectCommand({ Bucket: bucketId, Key: key }));
  }

  async deleteFolder(prefix: string, user: AuthenticatedUser | boolean = false): Promise<void> {
    const allowCrm = this.isAdmin(user);
    this.assertCrmAccess(prefix, allowCrm);
    await this.assertProjectFileAccess(prefix, user);
    if (!allowCrm && 'crm/'.startsWith(prefix)) throw new ForbiddenException('Нельзя удалить папку с файлами CRM');
    const bucketId = this.configService.get('AWS_BUCKET_ID') as string;
    let continuationToken: string | undefined;
    do {
      const list = await this.s3Client.send(
        new ListObjectsV2Command({ Bucket: bucketId, Prefix: prefix, ContinuationToken: continuationToken }),
      );
      const objects = list.Contents?.map((o) => ({ Key: o.Key! })) ?? [];
      if (objects.length) {
        await this.s3Client.send(new DeleteObjectsCommand({ Bucket: bucketId, Delete: { Objects: objects } }));
      }
      continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
    } while (continuationToken);
  }

  async getFiles(getFilesDto: GetFilesDto, user: AuthenticatedUser | boolean = false) {
    const allowCrm = this.isAdmin(user);
    this.assertCrmAccess(getFilesDto.prefix, allowCrm);
    await this.assertProjectFileAccess(getFilesDto.prefix, user);
    const bucketId = this.configService.get('AWS_BUCKET_ID') as string;
    const command = new ListObjectsV2Command({
      Bucket: bucketId,
      Prefix: getFilesDto.prefix,
    });

    const response = await this.s3Client.send(command);
    if (!response.Contents?.length) throw new NotFoundException('Файлов нет');
    return allowCrm ? response.Contents : response.Contents.filter((item) => !item.Key?.startsWith('crm/'));
  }
}
