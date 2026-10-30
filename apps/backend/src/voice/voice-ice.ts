import { createHmac } from 'node:crypto';

export interface VoiceIceServer { urls: string | string[]; username?: string; credential?: string }

export function configuredIceServers(raw: string, tenantMode: boolean): VoiceIceServer[] {
  let servers: VoiceIceServer[];
  try {
    servers = raw.trim().startsWith('[')
      ? JSON.parse(raw) as VoiceIceServer[]
      : raw.split(',').map((url) => url.trim()).filter(Boolean).map((urls) => ({ urls }));
  } catch { throw new Error('Некорректный MEDIASOUP_ICE_SERVERS'); }
  if (!Array.isArray(servers)) throw new Error('Некорректный MEDIASOUP_ICE_SERVERS');
  return servers.map((server) => {
    if (!server || typeof server !== 'object') throw new Error('Некорректный ICE server');
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    if (!urls.length || urls.some((url) => typeof url !== 'string' || !/^(?:stuns?|turns?):[^\s]+$/.test(url)) ||
      (server.username !== undefined && typeof server.username !== 'string') ||
      (server.credential !== undefined && typeof server.credential !== 'string')) throw new Error('Некорректный ICE server');
    if (tenantMode && urls.some((url) => /^turns?:/.test(url)))
      throw new Error('SaaS TURN requires MEDIASOUP_TURN_URLS and MEDIASOUP_TURN_SECRET, not shared static credentials');
    return { urls: server.urls, ...(server.username ? { username: server.username } : {}), ...(server.credential ? { credential: server.credential } : {}) };
  });
}

export function voiceIceServers(tenantId: string, userId: number): VoiceIceServer[] {
  const servers = configuredIceServers(
    process.env.MEDIASOUP_ICE_SERVERS ?? 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302',
    process.env.TENANCY_ENABLED === 'true',
  );
  const turnUrls = process.env.MEDIASOUP_TURN_URLS?.split(',').map((url) => url.trim()).filter(Boolean) ?? [];
  if (!turnUrls.length) return servers;
  const secret = process.env.MEDIASOUP_TURN_SECRET;
  if (!secret || secret.length < 32 || turnUrls.some((url) => !/^turns?:[^\s]+$/.test(url)))
    throw new Error('Некорректная конфигурация TURN');
  const lifetime = Number(process.env.MEDIASOUP_TURN_TTL_SECONDS ?? 86400);
  if (!Number.isSafeInteger(lifetime) || lifetime < 600 || lifetime > 86400) throw new Error('Некорректный срок TURN');
  const username = `${Math.floor(Date.now() / 1000) + lifetime}:${tenantId}:${userId}`;
  const credential = createHmac('sha1', secret).update(username).digest('base64');
  return [...servers, ...turnUrls.map((urls) => ({ urls, username, credential }))];
}

export function voicePortRange(): { min: number; max: number } {
  const min = Number(process.env.MEDIASOUP_MIN_PORT ?? 40000);
  const max = Number(process.env.MEDIASOUP_MAX_PORT ?? 49999);
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 1024 || max > 65535 || min >= max)
    throw new Error('Некорректный диапазон портов mediasoup');
  return { min, max };
}
