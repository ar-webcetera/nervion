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
  urls: string | string[];
  username?: string;
  credential?: string;
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
let microphoneStream: MediaStream | null = null;
let sessionGeneration = 0;
const consumers = ref<Map<string, Consumer>>(new Map());
const audioElements = new Map<string, HTMLAudioElement>();
const screenShareStreams = ref<Map<string, MediaStream>>(new Map());

const activeRoomId = ref<number | null>(null);
const participants = ref<VoiceParticipant[]>([]);
const isConnected = ref(false);
const isConnecting = ref(false);
const isMuted = ref(false);
const isScreenSharing = ref(false);
const error = ref<string | null>(null);

const pendingProducers: Array<{ roomId: number; producerId: string }> = [];

type SocketAck<T> = T & { error?: string };

const emit = <TResponse, TData extends object = object>(event: string, data?: TData): Promise<TResponse> => {
  return new Promise((resolve, reject) => {
    if (!socket.value?.connected) return reject(new Error('Соединение с голосовым сервером закрыто'));
    socket.value.timeout(15000).emit(event, data, (timeoutError: Error | null, response: SocketAck<TResponse>) => {
      if (timeoutError) return reject(new Error('Голосовой сервер не ответил. Подключитесь повторно'));
      if (response && typeof response === 'object' && 'error' in response && response.error) {
        reject(new Error(response.error as string));
      } else {
        resolve(response);
      }
    });
  });
};

const consumeProducer = async (roomId: number, producerId: string) => {
  if (!device.value || !recvTransport.value) return;
  if (consumers.value.has(producerId)) return;

  const rtpCapabilities = device.value.rtpCapabilities;
  const transport = recvTransport.value;
  const generation = sessionGeneration;

  try {
    const consumerParams = await emit<ConsumeParams>('consume', { roomId, producerId, rtpCapabilities });

    if (generation !== sessionGeneration || recvTransport.value !== transport) return;
    const consumer = await transport.consume({
      id: consumerParams.id,
      producerId: consumerParams.producerId,
      kind: consumerParams.kind,
      rtpParameters: consumerParams.rtpParameters,
    });
    if (generation !== sessionGeneration) { consumer.close(); return; }

    consumers.value.set(producerId, consumer);

    await emit('resume-consumer', { roomId, consumerId: consumer.id });

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
  const tenantApiBaseUrl = usePublicApiBaseUrl();
  const userStore = useUserStore();
  const tenantStore = useTenantStore();

  const joinRoom = async (roomId: number) => {
    if (isConnecting.value || isConnected.value) return;
    if (!tenantStore.canUse('voice') || tenantStore.readOnly) {
      error.value = tenantStore.readOnly ? 'Пространство доступно только для чтения' : 'Голосовая связь отключена';
      return;
    }
    isConnecting.value = true;
    activeRoomId.value = roomId;
    error.value = null;
    const generation = ++sessionGeneration;
    const assertCurrent = () => {
      if (sessionGeneration !== generation || !socket.value?.connected) throw new Error('Подключение отменено');
    };

    try {
      if (!socket.value) {
        socket.value = io(new URL('/voice', tenantApiBaseUrl || window.location.origin).toString(), {
          transports: ['websocket'],
          withCredentials: true,
          forceNew: true,
          reconnection: false,
          autoConnect: false,
        });

        socket.value.on('new-producer', async ({ producerId }: NewProducerEvent) => {
          if (!activeRoomId.value) return;
          if (!recvTransport.value) {
            pendingProducers.push({ roomId: activeRoomId.value, producerId });
            return;
          }
          await consumeProducer(activeRoomId.value, producerId);
        });

        socket.value.on('producer-closed', ({ producerId, kind }: ProducerClosedEvent) => {
          if (kind === 'video' && screenProducer.value?.id === producerId) {
            screenProducer.value.close();
            screenProducer.value = null;
            ownScreenStream.value?.getTracks().forEach((track) => track.stop());
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

        socket.value.on('participant-left', ({ userId }: { userId: number }) => {
          participants.value = participants.value.filter((participant) => participant.userId !== userId);
        });

        socket.value.on('voice-session-ended', ({ reason }: { reason: string }) => {
          error.value = reason;
          void leaveRoom();
        });

        socket.value.on('disconnect', (reason: string) => {
          if (reason !== 'io client disconnect' && isConnected.value && !error.value) error.value = 'Соединение с голосовой комнатой прервано';
          sessionGeneration++;
          microphoneStream?.getTracks().forEach((track) => track.stop());
          microphoneStream = null;
          ownScreenStream.value?.getTracks().forEach((track) => track.stop());
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
          activeRoomId.value = null;
          participants.value = [];
          screenShareStreams.value = new Map();
          isMuted.value = false;
          isConnecting.value = false;
          pendingProducers.splice(0);
          socket.value?.removeAllListeners();
          socket.value = null;
        });
      }

      const connectingSocket = socket.value;
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => finish(new Error('Не удалось подключиться к голосовому серверу')), 15000);
        const connected = () => finish();
        const failed = (cause: Error) => finish(cause);
        const finish = (cause?: Error) => {
          clearTimeout(timeout);
          connectingSocket.off('connect', connected);
          connectingSocket.off('connect_error', failed);
          if (cause) reject(cause); else resolve();
        };
        connectingSocket.once('connect', connected);
        connectingSocket.once('connect_error', failed);
        connectingSocket.connect();
      });
      assertCurrent();

      const joinResult = await emit<JoinRoomResponse>('join-room', { roomId });
      assertCurrent();

      activeRoomId.value = roomId;
      participants.value = joinResult.participants.map((p) => ({ ...p, muted: false }));

      const { Device: DeviceClass } = await import('mediasoup-client');
      const newDevice = new DeviceClass();
      await newDevice.load({ routerRtpCapabilities: joinResult.rtpCapabilities });
      assertCurrent();
      device.value = newDevice;

      // --- Send transport ---
      const sendParams = await emit<TransportParams>('create-transport', { roomId, direction: 'send' });
      assertCurrent();

      const st = newDevice.createSendTransport({
        id: sendParams.id,
        iceParameters: sendParams.iceParameters,
        iceCandidates: sendParams.iceCandidates,
        dtlsParameters: sendParams.dtlsParameters,
        iceServers: sendParams.iceServers,
      });

      st.on('connect', ({ dtlsParameters: dtls }, callback, errback) => {
        emit('connect-transport', { roomId, transportId: st.id, dtlsParameters: dtls })
          .then(() => callback())
          .catch(errback);
      });

      st.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
        const typedAppData: ProducerAppData = {
          source: (appData as ProducerAppData).source ?? ProducerSource.Microphone,
        };
        emit<ProduceIdResponse>('produce', { roomId, transportId: st.id, kind, rtpParameters, appData: typedAppData })
          .then(({ producerId: id }) => callback({ id }))
          .catch(errback);
      });
      st.on('connectionstatechange', (state) => {
        if (state === 'failed' && generation === sessionGeneration) {
          error.value = 'Не удалось установить медиасоединение. Проверьте сеть и подключитесь повторно';
          void leaveRoom();
        }
      });

      sendTransport.value = st;

      const recvParams = await emit<TransportParams>('create-transport', { roomId, direction: 'recv' });
      assertCurrent();

      const rt = newDevice.createRecvTransport({
        id: recvParams.id,
        iceParameters: recvParams.iceParameters,
        iceCandidates: recvParams.iceCandidates,
        dtlsParameters: recvParams.dtlsParameters,
        iceServers: recvParams.iceServers,
      });

      rt.on('connect', ({ dtlsParameters: dtls }, callback, errback) => {
        emit('connect-transport', { roomId, transportId: rt.id, dtlsParameters: dtls })
          .then(() => callback())
          .catch(errback);
      });
      rt.on('connectionstatechange', (state) => {
        if (state === 'failed' && generation === sessionGeneration) {
          error.value = 'Соединение с голосовой комнатой прервано';
          void leaveRoom();
        }
      });

      recvTransport.value = rt;

      const queued = pendingProducers.splice(0);
      for (const { producerId } of queued) {
        await consumeProducer(roomId, producerId);
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      if (generation !== sessionGeneration || !socket.value?.connected) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error('Подключение отменено');
      }
      microphoneStream = stream;
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
      if (generation !== sessionGeneration) { prod.close(); return; }
      producer.value = prod;

      for (const { producerId } of joinResult.existingProducers) {
        await consumeProducer(roomId, producerId);
      }

      assertCurrent();
      isConnected.value = true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Ошибка подключения к голосовой комнате';
      if (generation !== sessionGeneration) return;
      error.value = msg;
      console.error('[VoiceRoom]', e);
      await leaveRoom();
    } finally {
      if (generation === sessionGeneration) isConnecting.value = false;
    }
  };

  const leaveRoom = async () => {
    sessionGeneration++;
    if (activeRoomId.value !== null && socket.value) {
      socket.value.emit('leave-room', { roomId: activeRoomId.value });
    }

    screenProducer.value?.close();
    ownScreenStream.value?.getTracks().forEach((track) => track.stop());
    microphoneStream?.getTracks().forEach((track) => track.stop());
    microphoneStream = null;
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
    activeRoomId.value = null;
    participants.value = [];
    isConnected.value = false;
    isConnecting.value = false;
    isMuted.value = false;
  };

  const toggleMute = async () => {
    if (!activeRoomId.value || !socket.value) return;
    const generation = sessionGeneration;
    const muted = !isMuted.value;
    try {
      await emit('set-mute', { roomId: activeRoomId.value, muted });
      if (generation !== sessionGeneration) return;
      isMuted.value = muted;
      if (muted) producer.value?.pause(); else producer.value?.resume();
      const myParticipant = participants.value.find((p) => p.userId === userStore.user?.id);
      if (myParticipant) myParticipant.muted = muted;
    } catch (cause) { if (generation === sessionGeneration) error.value = cause instanceof Error ? cause.message : 'Не удалось переключить микрофон'; }
  };

  const startScreenShare = async () => {
    if (!sendTransport.value || !activeRoomId.value || isScreenSharing.value) return;
    const generation = sessionGeneration;
    const transport = sendTransport.value;

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      if (generation !== sessionGeneration || sendTransport.value !== transport) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const videoTrack = stream.getVideoTracks()[0];

      ownScreenStream.value = new MediaStream([videoTrack]);

      const prod = await transport.produce({
        track: videoTrack,
        appData: { source: ProducerSource.Screen },
      });
      if (generation !== sessionGeneration) { prod.close(); stream.getTracks().forEach((track) => track.stop()); return; }

      screenProducer.value = prod;
      isScreenSharing.value = true;

      videoTrack.onended = () => {
        void stopScreenShare();
      };
    } catch (e) {
      if (generation !== sessionGeneration) return;
      ownScreenStream.value?.getTracks().forEach((track) => track.stop());
      ownScreenStream.value = null;
      const msg = e instanceof Error ? e.message : 'Ошибка демонстрации экрана';
      if (!(e instanceof Error && e.name === 'NotAllowedError')) {
        error.value = msg;
      }
      console.error('[VoiceRoom] startScreenShare failed:', e);
    }
  };

  const stopScreenShare = async () => {
    if (!screenProducer.value || !activeRoomId.value) return;

    const producerId = screenProducer.value.id;
    screenProducer.value.close();
    ownScreenStream.value?.getTracks().forEach((track) => track.stop());
    screenProducer.value = null;
    ownScreenStream.value = null;
    isScreenSharing.value = false;

    try { await emit('stop-screen-share', { roomId: activeRoomId.value, producerId }); }
    catch (cause) { error.value = cause instanceof Error ? cause.message : 'Не удалось завершить демонстрацию'; }
  };

  return {
    joinRoom,
    leaveRoom,
    toggleMute,
    startScreenShare,
    stopScreenShare,
    activeRoomId: readonly(activeRoomId),
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
