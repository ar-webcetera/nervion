import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import { join } from 'path';
import { PLATFORM_ENTITIES } from './entities/platform.platform-entity';

dotenv.config();

export default new DataSource({
  type: 'postgres',
  host: process.env.PLATFORM_MIGRATION_POSTGRES_HOST || process.env.PLATFORM_POSTGRES_HOST,
  port: Number(process.env.PLATFORM_MIGRATION_POSTGRES_PORT || process.env.PLATFORM_POSTGRES_PORT || 5432),
  username: process.env.PLATFORM_MIGRATION_POSTGRES_USER,
  password: process.env.PLATFORM_MIGRATION_POSTGRES_PASSWORD,
  database: process.env.PLATFORM_POSTGRES_DB || 'nervion_platform',
  entities: PLATFORM_ENTITIES,
  migrations: [join(__dirname, 'migrations/*{.ts,.js}')],
  migrationsTableName: 'platform_migrations',
  synchronize: false,
  migrationsRun: false,
});
