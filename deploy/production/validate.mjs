import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { hostname, port, ingressBindAddress } from './config.mjs';

export function validateProduction(compose, project, phase) {
  const fail = () => { throw new Error('Production Compose violates the deployment boundary'); };
  if (!['precutover', 'live'].includes(phase) || !/^[a-z][a-z0-9_-]{2,62}$/.test(project || '') || compose.name !== project) fail();
  const allowed = ['postgres', 'backup', 'pgbouncer', 'redis', 'migrate', 'backend', 'frontend', 'smtp', 'gateway'];
  const services = compose.services || {};
  if (Object.keys(services).sort().join() !== allowed.sort().join()) fail();
  for (const service of Object.values(services)) {
    if (!/^(?:sha256:[a-f0-9]{64}|[a-zA-Z0-9._:/-]+@sha256:[a-f0-9]{64})$/.test(service.image || '') || service.build || service.container_name) fail();
  }
  if (services.backup.image !== services.postgres.image || services.smtp.image !== services.backend.image || services.migrate.image !== services.backend.image) fail();
  if (services.postgres.ports?.length || services.migrate.ports?.length || services.backup.ports?.length) fail();
  if (services.pgbouncer.user !== '10001:10001') fail();
  for (const name of ['backend', 'frontend', 'smtp', 'migrate']) if (services[name].user !== '0:0' || services[name].cap_drop?.join() !== 'ALL' || services[name].cap_add?.length) fail();
  for (const name of ['data_password', 'platform_password']) {
    const bootstrap = services.postgres.secrets?.find((item) => (item.target || item.source) === name);
    if (bootstrap?.source !== `bootstrap_${name}` || services.postgres.secrets.some((item) => item.source === name)) fail();
    for (const [serviceName, service] of Object.entries(services)) {
      if (serviceName !== 'postgres' && service.secrets?.some((item) => item.source === `bootstrap_${name}`)) fail();
    }
    if (!services.pgbouncer.secrets?.some((item) => item.source === name && (!item.target || item.target === name || item.target === `/run/secrets/${name}`))) fail();
    if (compose.secrets?.[`bootstrap_${name}`]?.file === compose.secrets?.[name]?.file) fail();
  }
  for (const name of ['backend', 'frontend', 'gateway']) if (services[name].network_mode !== 'host' || services[name].ports?.length) fail();
  if (services.backend.environment.BACKEND_BIND_HOST !== '127.0.0.1' || services.frontend.environment.NITRO_HOST !== '127.0.0.1') fail();
  if (services.backend.environment.TENANCY_ENABLED !== 'true' || services.migrate.environment.TENANCY_ENABLED !== 'true' || services.migrate.labels?.['io.nervion.release.migration'] !== 'tenant-only') fail();
  const backend = services.backend.environment;
  const frontend = services.frontend.environment;
  const gateway = services.gateway.environment;
  const smtp = services.smtp.environment;
  ingressBindAddress(gateway.PRODUCTION_INGRESS_BIND_IP);
  const ingress = services.gateway;
  if (ingress.user !== '101:101' || !ingress.read_only || ingress.cap_drop?.join() !== 'ALL' || ingress.cap_add?.length || !ingress.security_opt?.includes('no-new-privileges:true')) fail();
  const writable = ['/var/cache/nginx:uid=101,gid=101,mode=0700,size=16m', '/var/run:uid=101,gid=101,mode=0700,size=1m', '/etc/nginx/conf.d:uid=101,gid=101,mode=0700,size=1m'];
  if (ingress.tmpfs?.slice().sort().join() !== writable.sort().join() || ingress.volumes.some((volume) => !volume.read_only || writable.some((entry) => volume.target === entry.split(':')[0]))) fail();
  for (const name of ['backend', 'frontend', 'smtp', 'migrate']) if (services[name].environment.NERVION_DEPLOYMENT_PHASE !== phase) fail();
  if (services.backend.labels?.['io.nervion.release.production'] !== 'true') fail();
  for (const value of [backend.TENANCY_ROOT_DOMAIN, backend.PLATFORM_ADMIN_HOST, smtp.SMTP_TLS_SERVER_NAME]) hostname(value, 'production');
  if (gateway.PRODUCTION_ROOT_DOMAIN !== backend.TENANCY_ROOT_DOMAIN || gateway.PRODUCTION_ADMIN_HOST !== backend.PLATFORM_ADMIN_HOST || frontend.NUXT_PUBLIC_PLATFORM_ADMIN_HOST !== backend.PLATFORM_ADMIN_HOST) fail();
  const ports = [backend.PORT, frontend.PORT, gateway.PRODUCTION_HTTP_PORT, backend.POSTGRES_PORT, backend.REDIS_PORT].map((value) => port(value, 'production'));
  if (ports.some((value) => value < 1024) || new Set(ports).size !== ports.length) fail();
  if (String(gateway.PRODUCTION_BACKEND_PORT) !== String(backend.PORT) || String(gateway.PRODUCTION_FRONTEND_PORT) !== String(frontend.PORT)) fail();
  if (backend.POSTGRES_HOST !== '127.0.0.1' || backend.PLATFORM_POSTGRES_HOST !== '127.0.0.1' || backend.REDIS_HOST !== '127.0.0.1' || String(backend.PLATFORM_POSTGRES_PORT) !== String(backend.POSTGRES_PORT)) fail();
  for (const [name, expected, target] of [['pgbouncer', backend.POSTGRES_PORT, 6432], ['redis', backend.REDIS_PORT, 6379]]) {
    const bindings = services[name].ports;
    if (bindings?.length !== 1 || bindings[0].host_ip !== '127.0.0.1' || String(bindings[0].published) !== String(expected) || Number(bindings[0].target) !== target) fail();
  }
  const smtpPorts = services.smtp.ports;
  if (smtpPorts?.length !== 1 || Number(smtpPorts[0].target) !== 2525 || !['127.0.0.1', '0.0.0.0'].includes(smtpPorts[0].host_ip)) fail();
  const smtpPort = port(String(smtpPorts[0].published), 'smtp');
  if (ports.includes(smtpPort)) fail();
  if (phase === 'precutover' && (backend.TENANT_JOBS_WORKER_ENABLED !== 'false' || smtpPort !== 2525 || smtpPorts[0].host_ip !== '127.0.0.1')) fail();
  if (!['true', 'false'].includes(backend.TENANT_JOBS_WORKER_ENABLED)) fail();
  const min = port(String(backend.MEDIASOUP_MIN_PORT), 'media');
  const max = port(String(backend.MEDIASOUP_MAX_PORT), 'media');
  if (max < min || [...ports, smtpPort].some((value) => value >= min && value <= max)) fail();
  for (const name of ['backend', 'frontend', 'smtp']) {
    if (services[name].secrets.some((item) => /(?:migrator_password|postgres_password|pgbackrest_config|^bootstrap_)/.test(item.source))) fail();
    if (!services[name].read_only || !services[name].healthcheck || services[name].healthcheck.disable) fail();
  }
  const git = services.backend.volumes.find((volume) => volume.target === '/var/git');
  const tls = services.smtp.volumes.find((volume) => volume.target === '/run/nervion/smtp-tls');
  if (!git?.read_only || git.type !== 'bind' || !tls?.read_only || tls.type !== 'bind') fail();
  if (smtp.SMTP_TLS_CERT_FILE !== '/run/nervion/smtp-tls/current/fullchain.pem' || smtp.SMTP_TLS_KEY_FILE !== '/run/nervion/smtp-tls/current/privkey.pem') fail();
  if (!services.backup.volumes.filter((volume) => volume.type === 'volume').every((volume) => volume.read_only)) fail();
  for (const [name, volume] of Object.entries(compose.volumes || {})) {
    if (volume.external || volume.name !== `${project}_${name}`) fail();
  }
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const raw = readFileSync(0, 'utf8');
    if (raw.length > 1_048_576) throw new Error('Configuration too large');
    validateProduction(JSON.parse(raw), process.argv[2], process.argv[3]);
    console.log('Production Compose boundary validated; no containers changed');
  } catch { console.error('Production Compose validation failed'); process.exitCode = 1; }
}
