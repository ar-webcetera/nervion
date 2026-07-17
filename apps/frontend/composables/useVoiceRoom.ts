import { io, type Socket } from 'socket.io-client';
import type { Device, types as MediasoupTypes } from 'mediasoup-client';

type Transport = MediasoupTypes.Transport;
type Producer = MediasoupTypes.Producer;
type Consumer = MediasoupTypes.Consumer;
type RtpCapabilities = MediasoupTypes.RtpCapabilities;
type IceParameters = MediasoupTypes.IceParameters;
type IceCandidate = MediasoupTypes.IceCandidate;
type DtlsParameters = MediasoupTypes.DtlsParameters;
type RtpParameters = MediasoupTypes.RtpParameters;

export type MediaKind = 'audio' | 'video';

export enum ProducerSource {
  Microphone = 'microphone',
  Screen = 'screen',
}

export interface VoiceParticipant {
  userId: number;
  displayName: string;
  photoUrl: string | null;
  muted: boolean;
}

interface IceServer {
  urls: string;
}

interface TransportParams {
  id: string;
  iceParameters: IceParameters;
  iceCandidates: IceCandidate[];
  dtlsParameters: DtlsParameters;
  iceServers: IceServer[];
}

interface ConsumeParams {
  id: string;
  producerId: string;
  kind: MediaKind;
  rtpParameters: RtpParameters;
}

interface ExistingProducerInfo {
  producerId: string;
  userId: number;
  kind: MediaKind;
}

interface JoinRoomResponse {
  rtpCapabilities: RtpCapabilities;
  existingProducers: ExistingProducerInfo[];
  participants: Omit<VoiceParticipant, 'muted'>[];
}

interface NewProducerEvent {
  producerId: string;
  userId: number;
  kind: MediaKind;
}

interface ProducerClosedEvent {
  producerId: string;
  userId: number;
  kind: MediaKind;
}

interface ParticipantJoinedEvent {
  userId: number;
  displayName: string;
  photoUrl: string | null;
}

interface ParticipantMutedEvent {
  userId: number;
  muted: boolean;
}

interface ProduceIdResponse {
  producerId: string;
}

interface ProducerAppData {
  source: ProducerSource;
  [key: string]: string;
}

const socket = ref<Socket | null>(null);
const device = ref<Device | null>(null);
const sendTransport = ref<Transport | null>(null);
const recvTransport = ref<Transport | null>(null);
const producer = ref<Producer | null>(null);
const screenProducer = ref<Producer | null>(null);
const ownScreenStream = ref<MediaStream | null>(null);
const consumers = ref<Map<string, Consumer>>(new Map());
const audioElements = new Map<string, HTMLAudioElement>();
const screenShareStreams = ref<Map<string, MediaStream>>(new Map());

const activeProjectId = ref<number | null>(null);
const participants = ref<VoiceParticipant[]>([]);
const isConnected = ref(false);
const isConnecting = ref(false);
const isMuted = ref(false);
const isScreenSharing = ref(false);
const error = ref<string | null>(null);

const pendingProducers: Array<{ projectId: number; producerId: string }> = [];

type SocketAck<T> = T & { error?: string };

const emit = <TResponse, TData extends object = object>(event: string, data?: TData): Promise<TResponse> => {
  return new Promise((resolve, reject) => {
    if (!socket.value) return reject(new Error('No socket'));
    socket.value.emit(event, data, (response: SocketAck<TResponse>) => {
      if (response && typeof response === 'object' && 'error' in response && response.error) {
        reject(new Error(response.error as string));
      } else {
        resolve(response);
      }
    });
  });
};

const consumeProducer = async (projectId: number, producerId: string) => {
  if (!device.value || !recvTransport.value) return;
  if (consumers.value.has(producerId)) return;

  const rtpCapabilities = device.value.rtpCapabilities;

  try {
    const consumerParams = await emit<ConsumeParams>('consume', { projectId, producerId, rtpCapabilities });

    const consumer = await recvTransport.value.consume({
      id: consumerParams.id,
      producerId: consumerParams.producerId,
      kind: consumerParams.kind,
      rtpParameters: consumerParams.rtpParameters,
    });

    consumers.value.set(producerId, consumer);

    await emit('resume-consumer', { projectId, consumerId: consumer.id });

    if (consumerParams.kind === 'video') {
      const stream = new MediaStream([consumer.track]);
      screenShareStreams.value = new Map(screenShareStreams.value.set(producerId, stream));

      consumer.on('transportclose', () => {
        screenShareStreams.value = new Map([...screenShareStreams.value].filter(([k]) => k !== producerId));
        consumers.value.delete(producerId);
      });
    } else {
      const audioEl = new Audio();
      audioEl.srcObject = new MediaStream([consumer.track]);
      audioEl.autoplay = true;
      audioElements.set(producerId, audioEl);
      audioEl.play().catch((e) => console.warn('[VoiceRoom] autoplay blocked:', e));

      consumer.on('transportclose', () => {
        stopAudio(producerId);
        consumers.value.delete(producerId);
      });
    }
  } catch (e) {
    console.error('[VoiceRoom] consumeProducer failed for', producerId, e);
  }
};

const stopAudio = (producerId: string) => {
  const audioEl = audioElements.get(producerId);
  if (audioEl) {
    audioEl.pause();
    audioEl.srcObject = null;
    audioElements.delete(producerId);
  }
};

export const useVoiceRoom = () => {
  const config = useRuntimeConfig();
  const userStore = useUserStore();

  const joinRoom = async (projectId: number) => {
    if (isConnecting.value || isConnected.value) return;
    isConnecting.value = true;
    activeProjectId.value = projectId;
    error.value = null;

    try {
      if (!socket.value) {
        socket.value = io(new URL('/voice', config.public.API_URL).toString(), {
          transports: ['websocket'],
          auth: { user_id: userStore.user?.id },
        });

        socket.value.on('new-producer', async ({ producerId }: NewProducerEvent) => {
          if (!activeProjectId.value) return;
          if (!recvTransport.value) {
            pendingProducers.push({ projectId: activeProjectId.value, producerId });
            return;
          }
          await consumeProducer(activeProjectId.value, producerId);
        });

        socket.value.on('producer-closed', ({ producerId, userId, kind }: ProducerClosedEvent) => {
          if (kind === 'video' && screenProducer.value?.id === producerId) {
            screenProducer.value.close();
            screenProducer.value = null;
            ownScreenStream.value = null;
            isScreenSharing.value = false;
          }

          const consumer = consumers.value.get(producerId);
          if (consumer) {
            consumer.close();
            consumers.value.delete(producerId);
          }

          if (kind === 'video') {
            screenShareStreams.value = new Map([...screenShareStreams.value].filter(([k]) => k !== producerId));
          } else {
            stopAudio(producerId);
            participants.value = participants.value.filter((p) => p.userId !== userId);
          }
        });

        socket.value.on('participant-joined', (p: ParticipantJoinedEvent) => {
          if (!participants.value.find((x) => x.userId === p.userId)) {
            participants.value.push({ ...p, muted: false });
          }
        });

        socket.value.on('participant-muted', ({ userId, muted }: ParticipantMutedEvent) => {
          const p = participants.value.find((x) => x.userId === userId);
          if (p) p.muted = muted;
        });

        socket.value.on('disconnect', () => {
          producer.value?.close();
          producer.value = null;
          screenProducer.value?.close();
          screenProducer.value = null;
          ownScreenStream.value = null;
          isScreenSharing.value = false;

          for (const consumer of consumers.value.values()) consumer.close();
          consumers.value.clear();
          for (const producerId of audioElements.keys()) stopAudio(producerId);

          sendTransport.value?.close();
          sendTransport.value = null;
          recvTransport.value?.close();
          recvTransport.value = null;
          device.value = null;

          isConnected.value = false;
          activeProjectId.value = null;
          participants.value = [];
          screenShareStreams.value = new Map();
          isMuted.value = false;
        });
      }

      const joinResult = await emit<JoinRoomResponse>('join-room', { projectId });

      activeProjectId.value = projectId;
      participants.value = joinResult.participants.map((p) => ({ ...p, muted: false }));

      const { Device: DeviceClass } = await import('mediasoup-client');
      const newDevice = new DeviceClass();
      await newDevice.load({ routerRtpCapabilities: joinResult.rtpCapabilities });
      device.value = newDevice;

      // --- Send transport ---
      const sendParams = await emit<TransportParams>('create-transport', { projectId, direction: 'send' });

      const st = newDevice.createSendTransport({
        id: sendParams.id,
        iceParameters: sendParams.iceParameters,
        iceCandidates: sendParams.iceCandidates,
        dtlsParameters: sendParams.dtlsParameters,
        iceServers: sendParams.iceServers,
      });

      st.on('connect', ({ dtlsParameters: dtls }, callback, errback) => {
        emit('connect-transport', { projectId, transportId: st.id, dtlsParameters: dtls })
          .then(() => callback())
          .catch(errback);
      });

      st.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
        const typedAppData: ProducerAppData = {
          source: (appData as ProducerAppData).source ?? ProducerSource.Microphone,
        };
        emit<ProduceIdResponse>('produce', { projectId, transportId: st.id, kind, rtpParameters, appData: typedAppData })
          .then(({ producerId: id }) => callback({ id }))
          .catch(errback);
      });

      sendTransport.value = st;

      const recvParams = await emit<TransportParams>('create-transport', { projectId, direction: 'recv' });

      const rt = newDevice.createRecvTransport({
        id: recvParams.id,
        iceParameters: recvParams.iceParameters,
        iceCandidates: recvParams.iceCandidates,
        dtlsParameters: recvParams.dtlsParameters,
        iceServers: recvParams.iceServers,
      });

      rt.on('connect', ({ dtlsParameters: dtls }, callback, errback) => {
        emit('connect-transport', { projectId, transportId: rt.id, dtlsParameters: dtls })
          .then(() => callback())
          .catch(errback);
      });

      recvTransport.value = rt;

      const queued = pendingProducers.splice(0);
      for (const { producerId } of queued) {
        await consumeProducer(projectId, producerId);
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const audioTrack = stream.getAudioTracks()[0];

      const prod = await st.produce({
        track: audioTrack,
        appData: { source: ProducerSource.Microphone },
        codecOptions: {
          opusStereo: false,
          opusDtx: true,
          opusFec: true,
          opusMaxPlaybackRate: 48000,
          opusPtime: 20,
        },
      });
      producer.value = prod;

      for (const { producerId } of joinResult.existingProducers) {
        await consumeProducer(projectId, producerId);
      }

      isConnected.value = true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Ошибка подключения к голосовой комнате';
      error.value = msg;
      console.error('[VoiceRoom]', e);
      await leaveRoom();
    } finally {
      isConnecting.value = false;
    }
  };

  const leaveRoom = async () => {
    if (activeProjectId.value !== null && socket.value) {
      socket.value.emit('leave-room', { projectId: activeProjectId.value });
    }

    screenProducer.value?.close();
    screenProducer.value = null;
    ownScreenStream.value = null;
    isScreenSharing.value = false;

    producer.value?.close();
    producer.value = null;

    for (const consumer of consumers.value.values()) consumer.close();
    consumers.value.clear();

    for (const producerId of audioElements.keys()) stopAudio(producerId);
    screenShareStreams.value = new Map();

    sendTransport.value?.close();
    sendTransport.value = null;

    recvTransport.value?.close();
    recvTransport.value = null;

    device.value = null;

    socket.value?.disconnect();
    socket.value = null;

    pendingProducers.splice(0);
    activeProjectId.value = null;
    participants.value = [];
    isConnected.value = false;
    isMuted.value = false;
  };

  const toggleMute = async () => {
    if (!activeProjectId.value || !socket.value) return;
    isMuted.value = !isMuted.value;
    socket.value.emit('set-mute', { projectId: activeProjectId.value, muted: isMuted.value });

    const myParticipant = participants.value.find((p) => p.userId === userStore.user?.id);
    if (myParticipant) myParticipant.muted = isMuted.value;
  };

  const startScreenShare = async () => {
    if (!sendTransport.value || !activeProjectId.value || isScreenSharing.value) return;

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const videoTrack = stream.getVideoTracks()[0];

      ownScreenStream.value = new MediaStream([videoTrack]);

      const prod = await sendTransport.value.produce({
        track: videoTrack,
        appData: { source: ProducerSource.Screen },
      });

      screenProducer.value = prod;
      isScreenSharing.value = true;

      videoTrack.onended = () => {
        stopScreenShare();
      };
    } catch (e) {
      ownScreenStream.value = null;
      const msg = e instanceof Error ? e.message : 'Ошибка демонстрации экрана';
      if (!(e instanceof Error && e.name === 'NotAllowedError')) {
        error.value = msg;
      }
      console.error('[VoiceRoom] startScreenShare failed:', e);
    }
  };

  const stopScreenShare = async () => {
    if (!screenProducer.value || !activeProjectId.value) return;

    const producerId = screenProducer.value.id;
    screenProducer.value.close();
    screenProducer.value = null;
    ownScreenStream.value = null;
    isScreenSharing.value = false;

    await emit('stop-screen-share', { projectId: activeProjectId.value, producerId });
  };

  return {
    joinRoom,
    leaveRoom,
    toggleMute,
    startScreenShare,
    stopScreenShare,
    activeProjectId: readonly(activeProjectId),
    participants: readonly(participants),
    isConnected: readonly(isConnected),
    isConnecting: readonly(isConnecting),
    isMuted: readonly(isMuted),
    isScreenSharing: readonly(isScreenSharing),
    screenShareStreams: readonly(screenShareStreams),
    ownScreenStream: readonly(ownScreenStream),
    error: readonly(error),
  };
};
