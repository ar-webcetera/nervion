import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config();

const MIGRATIONS_PATH = resolve(__dirname, 'migrations');
const ENTITIES_PATH = resolve(__dirname, '');

export default new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST,
  port: Number(process.env.POSTGRES_PORT),
  username: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
  entities: [ENTITIES_PATH + '/**/*.entity{.ts,.js}'],
  migrations: [MIGRATIONS_PATH + '/*{.ts,.js}'],

  synchronize: false,
  logging: false,
});

console.log('Entities path:', ENTITIES_PATH + '/**/*.entity{.ts,.js}');
console.log('Migrations path:', MIGRATIONS_PATH + '/*{.ts,.js}');
