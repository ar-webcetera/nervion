export type RawFileResponse = {
  body: Uint8Array;
  contentType: string;
  contentLength?: number;
  etag?: string;
  lastModified?: Date;
};
