import { spawn } from 'node:child_process';
import { runtimeEnvironment } from './config.mjs';
import { httpProbe } from './health.mjs';
import { checkRuntimePrecutover } from './preflight.mjs';

const mode = process.argv[2];
let env;
try { env = runtimeEnvironment(mode, process.env); if (mode !== 'frontend') await checkRuntimePrecutover(env); }
catch { console.error('Production runtime configuration is invalid'); process.exit(1); }

const entrypoints = { backend: 'dist/main.js', frontend: '.output/server/index.mjs', smtp: 'dist/smtp-main.js' };
// A separate process group includes mediasoup workers. TERM/KILL reaches the
// entire group, including when the Node event loop can no longer release SFU leases.
const child = spawn(process.execPath, [entrypoints[mode]], { stdio: 'inherit', env, detached: true });
let stopping = false;
let timer;
let killTimer;
const groupSignal = (signal) => { if (child.pid) { try { process.kill(-child.pid, signal); } catch { /* already exited */ } } };
function stop() {
  if (stopping) return;
  stopping = true;
  clearTimeout(timer);
  groupSignal('SIGTERM');
  killTimer = setTimeout(() => groupSignal('SIGKILL'), mode === 'smtp' ? 45_000 : 10_000);
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
child.on('error', () => { console.error('Application process could not start'); process.exitCode = 1; });
child.on('exit', (code) => {
  clearTimeout(timer); clearTimeout(killTimer); groupSignal('SIGKILL');
  process.exitCode = stopping ? 1 : (code ?? 1);
});

if (mode === 'backend') {
  const started = Date.now();
  let ready = false;
  let failures = 0;
  async function watch() {
    try { await httpProbe(Number(env.PORT), '/api/platform/auth/me', env.PLATFORM_ADMIN_HOST, 401); ready = true; failures = 0; }
    catch { failures += 1; }
    if ((ready && failures >= 2) || (!ready && Date.now() - started > 120_000)) {
      console.error('Backend liveness failed; stopping application and media process group'); stop(); return;
    }
    if (!stopping) timer = setTimeout(watch, 5_000);
  }
  timer = setTimeout(watch, 5_000);
}
