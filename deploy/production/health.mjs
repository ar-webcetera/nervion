import { createRequire } from 'node:module';
import { get } from 'node:http';
import { connect as connectTcp } from 'node:net';
import { connect as connectTls } from 'node:tls';
import { pathToFileURL } from 'node:url';
import { secret } from './config.mjs';

export function httpProbe(port, path, host, expected) {
  return new Promise((resolve, reject) => {
    const request = get({ hostname: '127.0.0.1', port, path, headers: { Host: host }, timeout: 4_000 }, (response) => {
      response.resume(); response.statusCode === expected ? resolve() : reject(new Error('HTTP health failed'));
    });
    request.on('timeout', () => request.destroy(new Error('HTTP health timeout')));
    request.on('error', reject);
  });
}

// STARTTLS checks certificate trust/name/expiry. No MAIL FROM or RCPT TO is sent.
export function smtpProbe(port, servername) {
  return new Promise((resolve, reject) => {
    let socket = connectTcp({ host: '127.0.0.1', port });
    let buffer = ''; let stage = 'greeting'; let bytes = 0;
    const timeout = setTimeout(() => fail(), 5_000);
    function fail() { clearTimeout(timeout); socket.destroy(); reject(new Error('SMTP TLS health failed')); }
    socket.on('error', fail);
    function onData(chunk) {
      bytes += chunk.length;
      if (bytes > 16_384) return fail();
      buffer += chunk.toString('utf8');
      while (buffer.includes('\r\n')) {
        const end = buffer.indexOf('\r\n'); const line = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (!/^[0-9]{3}[ -]/.test(line)) return fail();
        if (line[3] === '-') continue;
        const code = Number(line.slice(0, 3));
        if (stage === 'greeting' && code === 220) { stage = 'ehlo'; socket.write('EHLO health.invalid\r\n'); }
        else if (stage === 'ehlo' && code === 250) { stage = 'starttls'; socket.write('STARTTLS\r\n'); }
        else if (stage === 'starttls' && code === 220) {
          socket.removeListener('data', onData); socket.removeListener('error', fail);
          socket = connectTls({ socket, servername, rejectUnauthorized: true, minVersion: 'TLSv1.2' });
          socket.on('error', fail);
          socket.once('secureConnect', () => { clearTimeout(timeout); socket.end('QUIT\r\n'); resolve(); });
          return;
        } else return fail();
      }
    }
    socket.on('data', onData);
  });
}

export async function databaseProbe(env, requireApp = createRequire('/app/package.json'), readSecret = secret) {
  const { Client } = requireApp('pg');
  for (const [prefix, passwordFile] of [['', 'data_password'], ['PLATFORM_', 'platform_password']]) {
    const client = new Client({ host: env[`${prefix}POSTGRES_HOST`], port: Number(env[`${prefix}POSTGRES_PORT`]),
      user: env[`${prefix}POSTGRES_USER`], database: env[`${prefix}POSTGRES_DB`], password: readSecret(passwordFile),
      connectionTimeoutMillis: 3_000, query_timeout: 3_000 });
    try {
      await client.connect();
      await client.query('BEGIN READ ONLY');
      await client.query("SET LOCAL statement_timeout = '3s'");
      await client.query('SELECT 1');
      await client.query('COMMIT');
    } finally { await client.end(); }
  }
}

async function main() {
  const env = process.env; const mode = process.argv[2];
  if (mode === 'frontend') return httpProbe(Number(env.PORT), '/platform', env.NUXT_PUBLIC_PLATFORM_ADMIN_HOST, 200);
  if (mode === 'smtp') await smtpProbe(Number(env.SMTP_PORT), env.SMTP_TLS_SERVER_NAME);
  else if (mode === 'backend') await httpProbe(Number(env.PORT), '/api/platform/auth/me', env.PLATFORM_ADMIN_HOST, 401);
  else throw new Error('Unknown health mode');
  await databaseProbe(env);
  if (mode === 'backend') {
    const { createClient } = createRequire('/app/package.json')('redis');
    const client = createClient({ socket: { host: env.REDIS_HOST, port: Number(env.REDIS_PORT), connectTimeout: 3_000, reconnectStrategy: false }, password: secret('redis_password') });
    client.on('error', () => {});
    try { await client.connect(); if (await client.ping() !== 'PONG') throw new Error('Redis health failed'); }
    finally { if (client.isOpen) await client.disconnect(); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const deadline = setTimeout(() => { console.error('Production health deadline exceeded'); process.exit(1); }, 12_000);
  main().then(() => { clearTimeout(deadline); process.exit(0); }, () => { console.error('Production health failed'); process.exit(1); });
}
