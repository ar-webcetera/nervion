import { ConfigService } from '@nestjs/config';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { FilesService } from './files.service';

describe('CRM attachment privacy', () => {
  const send = jest.fn();
  const service = new FilesService(
    Object.assign(new S3Client({ region: 'local' }), { send }),
    new ConfigService({ AWS_BUCKET_ID: 'test-bucket' }),
  );
  beforeEach(() => send.mockReset());
  it('rejects non-admin reads, writes and deletion before accessing storage', async () => {
    await expect(service.getRawFile('crm/deals/1/proposal.pdf')).rejects.toThrow('администраторам');
    await expect(service.getFileContent('crm/deals/1/proposal.pdf')).rejects.toThrow('администраторам');
    await expect(service.putFileContent('crm/deals/1/proposal.pdf', 'overwrite')).rejects.toThrow('администраторам');
    await expect(service.deleteFile('crm/deals/1/proposal.pdf')).rejects.toThrow('администраторам');
    await expect(service.deleteFolder('')).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
  it('does not expose private keys when browsing the root', async () => {
    send.mockResolvedValue({ Contents: [{ Key: 'crm/deals/1/proposal.pdf' }, { Key: 'tracker-tasks/1/file.pdf' }] });
    expect(await service.getFiles({ prefix: '' })).toEqual([{ Key: 'tracker-tasks/1/file.pdf' }]);
  });
  it('uploads CRM objects with private ACL', async () => {
    const exists = jest.spyOn(service, 'checkExistFile').mockResolvedValue(false);
    send.mockResolvedValue({ LastModified: new Date(), ETag: '"etag"', ContentLength: 4 });
    await service.unloadFile(
      { originalname: 'proposal.pdf', buffer: Buffer.from('test'), mimetype: 'application/pdf' } as Express.Multer.File,
      { prefix: 'crm/deals/1/' },
      true,
    );
    const command = send.mock.calls[0][0] as PutObjectCommand;
    expect(command.input.ACL).toBe('private');
    expect(command.input.Key).toBe('crm/deals/1/proposal.pdf');
    exists.mockRestore();
  });
});
