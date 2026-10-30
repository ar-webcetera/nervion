import type { IncomingHttpHeaders } from 'node:http';
import type { DtlsParameters, IceCandidate, IceParameters, MediaKind, RtpCapabilities, RtpParameters } from 'mediasoup/node/lib/types';
import type { ExistingProducerInfo, ProducerAppData } from './voice.service';
import { VoiceCommand } from './voice.enums';
import type { VoiceIceServer } from './voice-ice';

export interface VoicePeer {
  socketId: string;
  tenantId: string;
  userId: number;
  headers: IncomingHttpHeaders;
}

export interface VoiceBody {
  roomId: number;
  direction?: 'send' | 'recv';
  transportId?: string;
  dtlsParameters?: DtlsParameters;
  kind?: MediaKind;
  rtpParameters?: RtpParameters;
  appData?: ProducerAppData;
  producerId?: string;
  rtpCapabilities?: RtpCapabilities;
  consumerId?: string;
  muted?: boolean;
}

export interface VoiceRequest {
  peer: VoicePeer;
  command: VoiceCommand;
  body: VoiceBody;
}

export interface VoiceParticipantSummary {
  userId: number;
  displayName: string;
  photoUrl: string | null;
}

export interface VoiceReply {
  error?: string;
  id?: string;
  producerId?: string;
  kind?: MediaKind;
  rtpParameters?: RtpParameters;
  rtpCapabilities?: RtpCapabilities;
  existingProducers?: ExistingProducerInfo[];
  participants?: VoiceParticipantSummary[];
  iceParameters?: IceParameters;
  iceCandidates?: IceCandidate[];
  dtlsParameters?: DtlsParameters;
  iceServers?: VoiceIceServer[];
  connected?: boolean;
  resumed?: boolean;
  stopped?: boolean;
  left?: boolean;
  muted?: boolean;
}

export const voiceRoomKey = (tenantId: string, roomId: number): string => `${tenantId}:${roomId}`;
export const voiceSocketRoom = (key: string): string => `voice-room:${key}`;
