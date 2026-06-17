// Минимальные типы для mailauth — у пакета нет официальных деклараций
declare module 'mailauth' {
  interface MailauthStatus {
    result?: string;
    [key: string]: unknown;
  }

  interface MailauthResult {
    spf?: { status?: MailauthStatus };
    dkim?: { results?: Array<{ status?: MailauthStatus }> };
    dmarc?: { status?: MailauthStatus };
    [key: string]: unknown;
  }

  interface MailauthOptions {
    ip?: string;
    helo?: string;
    sender?: string;
    mta?: string;
    [key: string]: unknown;
  }

  export function authenticate(message: Buffer | string, options?: MailauthOptions): Promise<MailauthResult>;
}
