import { Injectable } from '@nestjs/common';
import { InboundMailData } from './mailbox.types';

export interface MailSpamAssessment {
  isSpam: boolean;
  score: number;
  reasons: string[];
}

const SPAM_SCORE_THRESHOLD = 5;
const SUSPICIOUS_PHRASES: { pattern: RegExp; reason: string }[] = [
  { pattern: /(?:вы выиграли|ваш выигрыш|заберите приз)/i, reason: 'Обещание выигрыша или приза' },
  { pattern: /(?:срочно переведите|немедленн(?:ая|о) оплат)/i, reason: 'Требование срочного перевода' },
  { pattern: /(?:быстр(?:ый|ого) заработок|доход без вложений)/i, reason: 'Обещание лёгкого заработка' },
  { pattern: /(?:casino|viagra|free money|claim (?:your )?prize)/i, reason: 'Характерная спам-фраза' },
  { pattern: /(?:криптовалют|инвестиц).{0,32}(?:гарант|без риск)/i, reason: 'Подозрительное инвестиционное предложение' },
];
const DANGEROUS_ATTACHMENT = /\.(?:bat|cmd|com|exe|hta|iso|js|jse|lnk|msi|ps1|scr|vbs|vbe|wsf)$/i;

@Injectable()
export class MailSpamService {
  assess(data: InboundMailData): MailSpamAssessment {
    let score = 0;
    const reasons: string[] = [];
    const add = (points: number, reason: string) => {
      score += points;
      reasons.push(reason);
    };

    const spf = data.authResults?.spf?.toLowerCase();
    const dkim = data.authResults?.dkim?.toLowerCase();
    const dmarc = data.authResults?.dmarc?.toLowerCase();

    if (dmarc === 'fail') add(3, 'DMARC не пройден');
    if (spf === 'fail') add(2, 'SPF не пройден');
    else if (spf === 'softfail') add(1, 'SPF завершён с softfail');
    if (dkim === 'fail') add(2, 'DKIM не пройден');

    const content = `${data.subject ?? ''}\n${data.text ?? ''}`.slice(0, 100_000);
    let phraseScore = 0;
    for (const phrase of SUSPICIOUS_PHRASES) {
      if (phrase.pattern.test(content) && phraseScore < 4) {
        const points = Math.min(2, 4 - phraseScore);
        phraseScore += points;
        add(points, phrase.reason);
      }
    }

    const linkCount = ((data.html ?? '').match(/<a\b[^>]*\bhref\s*=/gi) ?? []).length;
    if (linkCount >= 10) add(3, 'В письме десять или больше ссылок');
    else if (linkCount >= 6) add(2, 'В письме много ссылок');

    if (data.attachments.some((attachment) => DANGEROUS_ATTACHMENT.test(attachment.filename))) {
      add(4, 'Вложение с потенциально опасным расширением');
    }

    return { isSpam: score >= SPAM_SCORE_THRESHOLD, score, reasons };
  }
}
