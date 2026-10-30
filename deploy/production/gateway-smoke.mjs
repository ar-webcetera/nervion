import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Local cached image only. No production configuration, network, volumes or secrets.
const image = process.argv[2];
assert.match(image || '', /^sha256:[a-f0-9]{64}$/, 'Pass an exact verified local Nginx image ID');
const docker = (args, timeout = 30_000) => spawnSync('docker', ['--host', 'unix:///var/run/docker.sock', ...args], {
  env: { PATH: process.env.PATH, HOME: process.env.HOME }, encoding: 'utf8', timeout, maxBuffer: 64 * 1024,
});
const inspected = docker(['image', 'inspect', image, '--format', '{{.Id}}']);
assert.equal(inspected.status, 0, 'The exact image must already be present in the local daemon');
assert.equal(inspected.stdout.trim(), image);
const name = `nervion-gateway-smoke-${randomUUID()}`;
const directory = fileURLToPath(new URL('.', import.meta.url));
const args = ['run', '--rm', '--pull', 'never', '--name', name, '--network', 'none',
  '--user', '101:101', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
  '--memory', '32m', '--cpus', '0.2', '--pids-limit', '50',
  '--tmpfs', '/var/cache/nginx:uid=101,gid=101,mode=0700,size=16m',
  '--tmpfs', '/var/run:uid=101,gid=101,mode=0700,size=1m',
  '--tmpfs', '/etc/nginx/conf.d:uid=101,gid=101,mode=0700,size=1m'];
for (const [source, target] of [
  ['nginx.conf', '/etc/nginx/nginx.conf'],
  ['gateway.conf.template', '/etc/nginx/templates/default.conf.template'],
  ['gateway-entrypoint.sh', '/opt/nervion/gateway-entrypoint.sh'],
]) args.push('--mount', `type=bind,source=${directory}${source},target=${target},readonly`);
for (const value of ['PRODUCTION_ROOT_DOMAIN=example.test', 'PRODUCTION_ADMIN_HOST=admin.example.test',
  'PRODUCTION_INGRESS_BIND_IP=127.0.0.1', 'PRODUCTION_HTTP_PORT=13088', 'PRODUCTION_BACKEND_PORT=13026',
  'PRODUCTION_FRONTEND_PORT=13012', 'NGINX_ENVSUBST_FILTER=^PRODUCTION_']) args.push('--env', value);
args.push('--entrypoint', '/bin/sh', image, '-ec', `
  test "$(id -u):$(id -g)" = '101:101'
  grep -Eq '^CapEff:[[:space:]]+0+$' /proc/self/status
  for address in 127.0.0.1 10.2.3.4 172.16.0.1 172.31.255.254 192.168.2.1; do
    PRODUCTION_INGRESS_BIND_IP="$address" /bin/sh /opt/nervion/gateway-entrypoint.sh /bin/true
  done
  for address in '' 0.0.0.0 127.0.0.2 172.15.0.1 172.32.0.1 192.169.0.1 192.168.1.256 192.168.01.1 10.1 ::1 192.0.2.1 host.docker.internal; do
    if PRODUCTION_INGRESS_BIND_IP="$address" /bin/sh /opt/nervion/gateway-entrypoint.sh /bin/true >/dev/null 2>&1; then
      echo 'Gateway accepted an unsafe bind address' >&2
      exit 1
    fi
  done
  /bin/sh /opt/nervion/gateway-entrypoint.sh nginx -g 'daemon off;' &
  gateway_pid=$!
  trap 'kill -TERM "$gateway_pid" 2>/dev/null || true; wait "$gateway_pid" 2>/dev/null || true' EXIT
  attempts=0
  while [ "$attempts" -lt 20 ]; do
    kill -0 "$gateway_pid"
    if [ "$(wget -T 1 -q -O - http://127.0.0.1:13088/__nervion_health 2>/dev/null || true)" = 'ok' ]; then
      echo 'Non-root gateway HTTP smoke passed'
      exit 0
    fi
    attempts=$((attempts + 1))
    sleep 0.25
  done
  exit 1
`);
try {
  const result = docker(args);
  assert.equal(result.status, 0, `Isolated gateway failed: ${(result.stderr || result.stdout).slice(-4096)}`);
  assert.match(result.stdout, /Non-root gateway HTTP smoke passed/);
  console.log('Non-root gateway HTTP smoke passed with a read-only root, zero capabilities and no network access');
} finally {
  // This random, per-run name identifies only the fixture created above.
  docker(['rm', '--force', name], 10_000);
}
