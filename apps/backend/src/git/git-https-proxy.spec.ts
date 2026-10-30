import { request } from 'node:http';
import { withGitHttpsTunnel } from './git-https-proxy';

describe('Git HTTPS tunnel boundary', () => {
  const endpoint = { url: new URL('https://github.com/team/repo.git'), address: '140.82.114.3', family: 4 as const };

  it.each(['169.254.169.254:443', 'attacker.example:443', 'github.com:8443', 'github.com.:443', 'github.com@127.0.0.1:443'])(
    'denies an alternate target %s without opening an upstream connection',
    async (target) => {
      await withGitHttpsTunnel(endpoint, async (proxyUrl) => {
        const proxy = new URL(proxyUrl);
        const status = await new Promise<number>((resolve, reject) => {
          const req = request({ hostname: proxy.hostname, port: proxy.port, method: 'CONNECT', path: target });
          req.on('connect', (response, socket) => {
            socket.destroy();
            resolve(response.statusCode ?? 0);
          });
          req.on('error', reject);
          req.end();
        });
        expect(status).toBe(403);
      });
    },
  );

  it('denies a dumb HTTP alternate instead of forwarding it', async () => {
    await withGitHttpsTunnel(endpoint, async (proxyUrl) => {
      const proxy = new URL(proxyUrl);
      const status = await new Promise<number>((resolve, reject) => {
        const req = request(
          { hostname: proxy.hostname, port: proxy.port, method: 'GET', path: 'http://169.254.169.254/latest/meta-data/' },
          (response) => {
            response.resume();
            resolve(response.statusCode ?? 0);
          },
        );
        req.on('error', reject);
        req.end();
      });
      expect(status).toBe(403);
    });
  });
});
