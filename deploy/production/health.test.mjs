import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer as createHttp } from 'node:http';
import { createServer as createTcp } from 'node:net';
import { createSecureContext, TLSSocket } from 'node:tls';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { httpProbe } from './health.mjs';

async function listen(server) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return server.address().port;
}

test('HTTP health requires the exact status and forwards the expected host', async (t) => {
  let host;
  const server = createHttp((request, response) => { host = request.headers.host; response.writeHead(request.url === '/ready' ? 401 : 503); response.end(); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = await listen(server);
  await httpProbe(port, '/ready', 'admin.example.test', 401);
  assert.equal(host, 'admin.example.test');
  await assert.rejects(httpProbe(port, '/not-ready', 'admin.example.test', 401));
});

test('SMTP health verifies STARTTLS certificate identity and never submits a message', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'nervion-smtp-health-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const key = join(directory, 'key.pem'); const cert = join(directory, 'cert.pem');
  const generated = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
    '-days', '1', '-subj', '/CN=mail.example.test', '-addext', 'subjectAltName=DNS:mail.example.test'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(generated.status, 0, 'Could not create isolated test certificate');
  const context = createSecureContext({ key: readFileSync(key), cert: readFileSync(cert) });
  const commands = [];
  const sockets = new Set();
  const server = createTcp((socket) => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
    socket.write('220 fixture ESMTP\r\n');
    let buffer = '';
    const read = (data) => {
      buffer += data.toString();
      while (buffer.includes('\r\n')) {
        const index = buffer.indexOf('\r\n'); const command = buffer.slice(0, index); buffer = buffer.slice(index + 2); commands.push(command);
        if (command.startsWith('EHLO ')) socket.write('250-fixture\r\n250 STARTTLS\r\n');
        else if (command === 'STARTTLS') {
          socket.removeListener('data', read); socket.write('220 Begin TLS\r\n');
          const secure = new TLSSocket(socket, { isServer: true, secureContext: context });
          secure.on('error', () => {});
          secure.on('data', (data) => { commands.push(data.toString().trim()); secure.end('221 Goodbye\r\n'); });
        } else socket.end('500 Unexpected command\r\n');
      }
    };
    socket.on('data', read);
  });
  t.after(() => { for (const socket of sockets) socket.destroy(); server.close(); });
  const port = await listen(server);
  async function probe(host, trust) {
    return new Promise((resolve, reject) => {
      const source = `import {smtpProbe} from ${JSON.stringify(new URL('./health.mjs', import.meta.url).href)}; try { await smtpProbe(${port},${JSON.stringify(host)}); process.exit(0); } catch { process.exit(1); }`;
      const child = spawn(process.execPath, ['--input-type=module', '-e', source], { env: { PATH: process.env.PATH, ...(trust ? { NODE_EXTRA_CA_CERTS: cert } : {}) }, stdio: 'ignore' });
      const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('SMTP fixture timed out')); }, 10000);
      child.once('error', reject); child.once('exit', (code) => { clearTimeout(timeout); resolve(code); });
    });
  }
  assert.equal(await probe('mail.example.test', true), 0);
  assert.equal(await probe('another.example.test', true), 1);
  assert.equal(await probe('mail.example.test', false), 1);
  assert.ok(commands.includes('STARTTLS'));
  assert.equal(commands.some((command) => /^(?:MAIL|RCPT|DATA)\b/.test(command)), false);
});
