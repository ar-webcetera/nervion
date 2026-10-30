import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import { resolve } from 'node:path';

dotenv.config();

if (process.env.TENANCY_ENABLED !== 'true') {
  throw new Error('Tenant migrations require TENANCY_ENABLED=true.');
}
if (!process.env.MIGRATION_POSTGRES_USER || !process.env.MIGRATION_POSTGRES_PASSWORD) {
  throw new Error('Tenant migrations require dedicated MIGRATION_POSTGRES_USER and MIGRATION_POSTGRES_PASSWORD.');
}
if (!process.env.TENANCY_BOOTSTRAP_TENANT_ID) {
  throw new Error('TENANCY_BOOTSTRAP_TENANT_ID must identify the existing workspace before tenant migration.');
}

export default new DataSource({
  type: 'postgres',
  host: process.env.MIGRATION_POSTGRES_HOST || process.env.POSTGRES_HOST,
  port: Number(process.env.MIGRATION_POSTGRES_PORT || process.env.POSTGRES_PORT || 5432),
  username: process.env.MIGRATION_POSTGRES_USER,
  password: process.env.MIGRATION_POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
  migrations: [resolve(__dirname, 'tenant-migrations/[0-9]*{.ts,.js}')],
  migrationsTableName: 'tenant_migrations',
  migrationsTransactionMode: 'all',
  migrationsRun: false,
  synchronize: false,
  logging: false,
});
