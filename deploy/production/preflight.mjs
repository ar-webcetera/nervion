import { createRequire } from 'node:module';

export function assertPrecutoverSnapshot(row) {
  if (!row || row.total < 1 || row.safe !== true || row.bootstrap !== true) throw new Error('Precutover tenant state is not read-only with mail disabled');
}

export async function checkPrecutoverClient(client, tenantId) {
  const { rows: [row] } = await client.query(`SELECT count(*)::integer AS total,
    bool_and(status='read_only' AND feature_flags @> '{"mail":false}'::jsonb) AS safe,
    bool_or(id=$1::uuid) AS bootstrap FROM platform_tenants`, [tenantId]);
  assertPrecutoverSnapshot(row);
}

export async function checkRuntimePrecutover(env, requireApp = createRequire('/app/package.json')) {
  if (env.NERVION_DEPLOYMENT_PHASE !== 'precutover') return;
  if (env.TENANT_JOBS_WORKER_ENABLED !== 'false') throw new Error('Precutover workers must be disabled');
  const { Client } = requireApp('pg');
  const client = new Client({ host: env.PLATFORM_POSTGRES_HOST, port: Number(env.PLATFORM_POSTGRES_PORT),
    user: env.PLATFORM_POSTGRES_USER, password: env.PLATFORM_POSTGRES_PASSWORD, database: env.PLATFORM_POSTGRES_DB,
    connectionTimeoutMillis: 5_000, query_timeout: 5_000 });
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '5s'");
    await checkPrecutoverClient(client, env.TENANCY_BOOTSTRAP_TENANT_ID);
    await client.query('COMMIT');
  }
  finally { await client.end(); }
}
