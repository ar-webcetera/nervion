import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config();

const tenancyEnabled = process.env.TENANCY_ENABLED === 'true';
if (tenancyEnabled && (!process.env.MIGRATION_POSTGRES_USER || !process.env.MIGRATION_POSTGRES_PASSWORD)) {
  throw new Error('SaaS migrations require separate MIGRATION_POSTGRES_USER and MIGRATION_POSTGRES_PASSWORD.');
}

const MIGRATIONS_PATH = resolve(__dirname, 'migrations');
const ENTITIES_PATH = resolve(__dirname, '');

export default new DataSource({
  type: 'postgres',
  host: process.env.MIGRATION_POSTGRES_HOST || process.env.POSTGRES_HOST,
  port: Number(process.env.MIGRATION_POSTGRES_PORT || process.env.POSTGRES_PORT || 5432),
  username: process.env.MIGRATION_POSTGRES_USER || process.env.POSTGRES_USER,
  password: process.env.MIGRATION_POSTGRES_PASSWORD || process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
  entities: [ENTITIES_PATH + '/**/*.entity{.ts,.js}'],
  migrations: [MIGRATIONS_PATH + '/*{.ts,.js}'],

  synchronize: false,
  migrationsRun: false,
  logging: false,
});

console.log('Entities path:', ENTITIES_PATH + '/**/*.entity{.ts,.js}');
console.log('Migrations path:', MIGRATIONS_PATH + '/*{.ts,.js}');
