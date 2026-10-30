import { ServiceUnavailableException } from '@nestjs/common';
import { createServer } from 'node:http';
import { connect, type Socket } from 'node:net';
import type { PublicEndpoint } from '../common/network/public-endpoint';

/** Git can discover alternate URLs without an HTTP redirect. Restrict every tunnel. */
export async function withGitHttpsTunnel<T>(endpoint: PublicEndpoint, callback: (proxyUrl: string) => Promise<T>): Promise<T> {
  const sockets = new Set<Socket>();
  const server = createServer((_request, response) => {
    response.writeHead(403);
    response.end();
  });
  server.on('connection', (socket) => {
    if (sockets.size >= 32) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());
    socket.setTimeout(25_000, () => socket.destroy());
  });
  server.on('connect', (request, client, head) => {
    if (client.destroyed) return;
    if (request.url !== `${endpoint.url.hostname}:443`) {
      client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    const upstream = connect({ host: endpoint.address, family: endpoint.family, port: 443 });
    sockets.add(upstream);
    upstream.setTimeout(25_000, () => upstream.destroy());
    const timeout = setTimeout(() => upstream.destroy(), 3_000);
    timeout.unref();
    upstream.on('connect', () => {
      clearTimeout(timeout);
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      client.pipe(upstream).pipe(client);
    });
    upstream.on('error', () => client.destroy());
    upstream.on('close', () => {
      clearTimeout(timeout);
      sockets.delete(upstream);
      client.destroy();
    });
    client.on('close', () => upstream.destroy());
    client.on('error', () => upstream.destroy());
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', () => reject(new ServiceUnavailableException('Безопасное Git-подключение недоступно')));
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new ServiceUnavailableException('Безопасное Git-подключение недоступно');
    return await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    for (const socket of sockets) socket.destroy();
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
