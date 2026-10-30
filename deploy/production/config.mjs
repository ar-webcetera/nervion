import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';

export function secret(name, allowEmpty = false) {
  const value = readFileSync(`/run/secrets/${name}`, 'utf8').trim();
  if (!value && !allowEmpty) throw new Error(`Required secret is empty: ${name}`);
  return value;
}

export function port(value, key) {
  if (!/^[1-9][0-9]{0,4}$/.test(value || '') || Number(value) > 65535) {
    throw new Error(`Invalid port: ${key}`);
  }
  return Number(value);
}

export function hostname(value, key) {
  if (!value || value.length > 253 || !value.includes('.') || !value.split('.').every((label) =>
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw new Error(`Invalid hostname: ${key}`);
  return value;
}

export function ingressBindAddress(value) {
  if (isIP(value || '') !== 4) throw new Error('Ingress requires an explicit private IPv4 address');
  const [first, second] = value.split('.').map(Number);
  if (value !== '127.0.0.1' && first !== 10 && !(first === 172 && second >= 16 && second <= 31) && !(first === 192 && second === 168)) {
    throw new Error('Ingress must bind to loopback or a verified RFC1918 interface');
  }
  return value;
}

export function runtimeEnvironment(mode, source, readSecret = secret) {
  if (!['backend', 'frontend', 'smtp'].includes(mode)) throw new Error('Invalid runtime mode');
  const env = { ...source };
  for (const key of Object.keys(env)) {
    if (/^(?:PLATFORM_)?MIGRATION_/.test(key) || /^PG(?:PASSWORD|SERVICE|SERVICEFILE|PASSFILE)$/.test(key)) delete env[key];
  }
  if (env.NODE_ENV !== 'production') throw new Error('Production runtime requires NODE_ENV=production');
  if (!['precutover', 'live'].includes(env.NERVION_DEPLOYMENT_PHASE)) throw new Error('Explicit deployment phase is required');
  if (mode === 'frontend') {
    if (env.NUXT_PUBLIC_TENANCY_ENABLED !== 'true' || env.NITRO_HOST !== '127.0.0.1') throw new Error('Frontend must use tenant mode and loopback');
    port(env.PORT, 'PORT');
    hostname(env.NUXT_PUBLIC_PLATFORM_ADMIN_HOST, 'NUXT_PUBLIC_PLATFORM_ADMIN_HOST');
    env.NUXT_TENANCY_PROXY_SECRET = readSecret('tenancy_proxy_secret');
    return env;
  }
  if (env.TENANCY_ENABLED !== 'true') throw new Error('Production runtime requires tenant mode');
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(env.TENANCY_BOOTSTRAP_TENANT_ID || '')) throw new Error('Preserved bootstrap tenant UUID is required');
  if (env.NERVION_DEPLOYMENT_PHASE === 'precutover' && env.TENANT_JOBS_WORKER_ENABLED !== 'false') throw new Error('Precutover workers must be disabled');
  if (env.POSTGRES_USER !== 'nervion_data' || env.POSTGRES_DB !== 'nervion_data_1' ||
      env.PLATFORM_POSTGRES_USER !== 'nervion_platform' || env.PLATFORM_POSTGRES_DB !== 'nervion_platform') throw new Error('Unexpected runtime database role or name');
  for (const [key, name] of Object.entries({
    POSTGRES_PASSWORD: 'data_password', PLATFORM_POSTGRES_PASSWORD: 'platform_password',
    JWT_SECRET: 'jwt_secret', AWS_ACCESS_KEY_ID: 'storage_access_key', AWS_SECRET_ACCESS_KEY: 'storage_secret_key',
    MAILBOX_TENANTS_JSON: 'mail_tenants_json',
  })) env[key] = readSecret(name);
  const endpoint = new URL(env.AWS_ENDPOINT);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) throw new Error('Production storage requires HTTPS without URL credentials');
  env.SENTRY_DSN = readSecret('sentry_dsn', true);
  if (env.PUSH_ENABLED !== 'false') {
    env.VAPID_PUBLIC_KEY = readSecret('vapid_public_key');
    env.VAPID_PRIVATE_KEY = readSecret('vapid_private_key');
  }
  if (mode === 'smtp') {
    port(env.SMTP_PORT, 'SMTP_PORT');
    hostname(env.SMTP_TLS_SERVER_NAME, 'SMTP_TLS_SERVER_NAME');
    if (env.SMTP_TLS_CERT_FILE !== '/run/nervion/smtp-tls/current/fullchain.pem' || env.SMTP_TLS_KEY_FILE !== '/run/nervion/smtp-tls/current/privkey.pem') throw new Error('SMTP TLS files are required');
    env.TENANT_JOBS_WORKER_ENABLED = 'false';
    return env;
  }
  if (env.BACKEND_BIND_HOST !== '127.0.0.1') throw new Error('Host-network backend must bind HTTP to loopback');
  port(env.PORT, 'PORT');
  port(env.POSTGRES_PORT, 'POSTGRES_PORT');
  port(env.PLATFORM_POSTGRES_PORT, 'PLATFORM_POSTGRES_PORT');
  if (env.POSTGRES_HOST !== '127.0.0.1' || env.PLATFORM_POSTGRES_HOST !== '127.0.0.1' || env.REDIS_HOST !== '127.0.0.1') throw new Error('Host-network dependencies must use loopback');
  if (!isIP(env.MEDIASOUP_ANNOUNCED_IP || '')) throw new Error('Media announced address must be an IP');
  hostname(env.PLATFORM_ADMIN_HOST, 'PLATFORM_ADMIN_HOST');
  const min = port(env.MEDIASOUP_MIN_PORT, 'MEDIASOUP_MIN_PORT');
  const max = port(env.MEDIASOUP_MAX_PORT, 'MEDIASOUP_MAX_PORT');
  if (max < min || [env.PORT, env.POSTGRES_PORT, env.REDIS_PORT].some((p) => Number(p) >= min && Number(p) <= max)) throw new Error('Media range overlaps an application port');
  env.REDIS_URL = `redis://:${encodeURIComponent(readSecret('redis_password'))}@127.0.0.1:${port(env.REDIS_PORT, 'REDIS_PORT')}/0`;
  for (const [key, name] of Object.entries({
    TENANCY_PROXY_SECRET: 'tenancy_proxy_secret', PLATFORM_ADMIN_PASSWORD_HASH: 'platform_admin_password_hash',
    GIT_CREDENTIAL_KEY: 'git_credential_key', GIT_EXTERNAL_REPOSITORIES_JSON: 'git_external_repositories_json',
  })) env[key] = readSecret(name);
  if (env.MEDIASOUP_TURN_URLS) env.MEDIASOUP_TURN_SECRET = readSecret('turn_secret');
  if (env.YANDEX_OAUTH_CLIENT_ID) env.YANDEX_OAUTH_CLIENT_SECRET = readSecret('yandex_client_secret');
  if (env.AI_ENABLED !== 'false') {
    env.OPENAI_API_KEY = readSecret('openai_api_key', true);
    env.OPENROUTER_API_KEY = readSecret('openrouter_api_key', true);
    if (!env.OPENAI_API_KEY && !env.OPENROUTER_API_KEY) throw new Error('Enabled AI requires a provider secret');
  }
  return env;
}
