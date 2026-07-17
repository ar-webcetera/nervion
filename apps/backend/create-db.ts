import { createConnection } from 'typeorm';

async function createDatabase() {
  const connection = await createConnection({
    type: 'postgres',
    host: process.env.POSTGRES_HOST || 'localhost',
    port: Number(process.env.POSTGRES_PORT) || 5432,
    username: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD,
    database: 'postgres',
  });

  const dbName = process.env.POSTGRES_DB || 'tracker';
  await connection.query(`CREATE DATABASE "${dbName}";`);
  await connection.close();
}

createDatabase().then(() => console.log('Database created successfully!'));
