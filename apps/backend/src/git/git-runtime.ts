import { BadRequestException } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const MAX_BUFFER = 64 * 1024 * 1024;
const GIT_TIMEOUT = 20_000;

/** No inherited credentials, proxy settings, hooks, filters or global Git config. */
export function gitEnvironment(config: Array<[string, string]> = [], protocol = 'https'): NodeJS.ProcessEnv {
  const settings: Array<[string, string]> = [
    ['core.hooksPath', '/dev/null'],
    ['core.attributesFile', '/dev/null'],
    ['core.fsmonitor', 'false'],
    ['credential.helper', ''],
    ['credential.interactive', 'false'],
    ['protocol.allow', 'never'],
    [`protocol.${protocol}.allow`, 'always'],
    ['http.proxy', ''],
    ['http.sslVerify', 'true'],
    ['http.followRedirects', 'false'],
    ['http.extraHeader', ''],
    ['http.cookieFile', ''],
    ['http.saveCookies', 'false'],
    ['http.lowSpeedLimit', '1024'],
    ['http.lowSpeedTime', '10'],
    ['fetch.recurseSubmodules', 'false'],
    ['submodule.recurse', 'false'],
    ['maintenance.auto', 'false'],
    ['gc.auto', '0'],
    ['transfer.fsckObjects', 'true'],
    ['fetch.fsckObjects', 'true'],
    ['fetch.writeCommitGraph', 'false'],
    ...config,
  ];
  const env: NodeJS.ProcessEnv = {
    PATH: '/usr/local/bin:/usr/bin:/bin',
    HOME: '/nonexistent',
    XDG_CONFIG_HOME: '/nonexistent',
    LANG: 'C.UTF-8',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '/bin/false',
    SSH_ASKPASS: '/bin/false',
    GIT_SSH_COMMAND: '/bin/false',
    GIT_ALLOW_PROTOCOL: protocol,
    GIT_PROTOCOL_FROM_USER: '0',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_NO_LAZY_FETCH: '1',
    GIT_ATTR_NOSYSTEM: '1',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_CONFIG_COUNT: String(settings.length),
  };
  settings.forEach(([key, value], index) => {
    env[`GIT_CONFIG_KEY_${index}`] = key;
    env[`GIT_CONFIG_VALUE_${index}`] = value;
  });
  return env;
}

export async function directoryBytes(directory: string): Promise<number> {
  let total = 0;
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new BadRequestException('Символические ссылки в Git-хранилище запрещены');
    if (entry.isDirectory()) total += await directoryBytes(path);
    else if (entry.isFile()) {
      const stat = await lstat(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (stat?.isSymbolicLink()) throw new BadRequestException('Символические ссылки в Git-хранилище запрещены');
      total += stat?.size ?? 0;
    } else throw new BadRequestException('Некорректный объект в Git-хранилище');
  }
  return total;
}

/** Never expose stderr/Error: Git may include auth headers, URLs and local paths. */
export function executeGit(
  args: string[],
  env = gitEnvironment(),
  quota?: { directory: string; bytes: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setInterval> | undefined;
    let checking = false;
    let quotaFailed = false;
    let failed = false;
    let finished = false;
    let bytes = 0;
    const output: Buffer[] = [];
    const child = spawn('git', args, { env, cwd: '/tmp', detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const kill = () => {
      if (finished) return;
      failed = true;
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    };
    const timeout = setTimeout(kill, GIT_TIMEOUT);
    timeout.unref();
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_BUFFER) kill();
      else output.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_BUFFER) kill();
    });
    child.on('error', () => {
      failed = true;
    });
    child.on('close', (code) => {
      finished = true;
      clearTimeout(timeout);
      if (timer) clearInterval(timer);
      if (quotaFailed) return reject(new BadRequestException('Репозиторий превышает лимит хранилища'));
      if (failed || code !== 0)
        return reject(new BadRequestException('Операция Git не выполнена. Проверьте адрес, права доступа и размер репозитория'));
      resolve(Buffer.concat(output));
    });
    if (quota) {
      timer = setInterval(() => {
        if (checking) return;
        checking = true;
        void directoryBytes(quota.directory)
          .then((bytes) => {
            if (!finished && bytes > quota.bytes) {
              quotaFailed = true;
              kill();
            }
          })
          .catch(() => {
            if (!finished) {
              quotaFailed = true;
              kill();
            }
          })
          .finally(() => {
            checking = false;
          });
      }, 500);
      timer.unref();
    }
  });
}
