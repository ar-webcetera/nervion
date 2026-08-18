import { MailSpamService } from './mail-spam.service';
import { InboundMailData } from './mailbox.types';

const mail = (overrides: Partial<InboundMailData> = {}): InboundMailData => ({
  messageId: '<message@test>',
  notificationId: null,
  inReplyTo: null,
  referencesHeader: null,
  from: { address: 'sender@example.com' },
  to: [{ address: 'info@example.com' }],
  cc: [],
  subject: 'Обычное письмо',
  text: 'Здравствуйте, направляю документы.',
  html: null,
  rawS3Key: 'mail/raw/message',
  authResults: { spf: 'pass', dkim: 'pass', dmarc: 'pass' },
  attachments: [],
  ...overrides,
});

describe('MailSpamService', () => {
  const service = new MailSpamService();

  it('не помечает обычное письмо как спам', () => {
    expect(service.assess(mail())).toEqual({ isSpam: false, score: 0, reasons: [] });
  });

  it('помечает письмо с проваленной аутентификацией и опасным вложением', () => {
    const assessment = service.assess(
      mail({
        authResults: { spf: 'fail', dkim: 'fail', dmarc: 'fail' },
        attachments: [
          {
            filename: 'invoice.exe',
            contentType: 'application/octet-stream',
            size: 128,
            content: Buffer.from('test'),
            contentId: null,
            isInline: false,
          },
        ],
      }),
    );

    expect(assessment.isSpam).toBe(true);
    expect(assessment.score).toBeGreaterThanOrEqual(5);
    expect(assessment.reasons).toContain('DMARC не пройден');
    expect(assessment.reasons).toContain('Вложение с потенциально опасным расширением');
  });
});
