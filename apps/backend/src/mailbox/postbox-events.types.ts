import type { JsonObject, JsonValue } from '@tracker/contracts';

export interface PostboxMailObject {
  timestamp?: string;
  messageId?: string;
  identityId?: string;
  commonHeaders?: {
    from?: string[];
    to?: string[];
    messageId?: string;
    subject?: string;
    date?: string;
  };
  tags?: Record<string, string[]>;
}

export interface PostboxEventPayload {
  eventType?: string;
  eventId?: string;
  mail?: PostboxMailObject;
  open?: { ipAddress?: string; timestamp?: string; userAgent?: string };
  click?: { ipAddress?: string; timestamp?: string; userAgent?: string; url?: string };
  bounce?: {
    bounceType?: string;
    bounceSubType?: string;
    timestamp?: string;
    bouncedRecipients?: Array<{ emailAddress?: string; diagnosticCode?: string }>;
  };
  complaint?: {
    timestamp?: string;
    complaintFeedbackType?: string;
    complainedRecipients?: Array<{ emailAddress?: string }>;
  };
  delivery?: { timestamp?: string; recipients?: string[] };
  [key: string]: JsonValue | PostboxMailObject | undefined;
}

export interface PostboxKinesisRecord {
  kinesis?: { data?: string };
  Data?: string | Uint8Array;
}

export interface PostboxEventsIngestBody {
  eventType?: string;
  Records?: PostboxKinesisRecord[];
  events?: PostboxEventPayload[];
  /** Формат триггера Cloud Functions ← Data Streams. */
  messages?: Array<PostboxEventPayload | string | { data?: string }>;
  [key: string]:
    | JsonValue
    | PostboxKinesisRecord[]
    | PostboxEventPayload[]
    | Array<PostboxEventPayload | string | { data?: string }>
    | undefined;
}

export type PostboxEventMeta = JsonObject;
