import pg from 'pg';
import { runMigrations } from '../src/db/migrate';

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL!;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  // Start from a clean schema every run.
  await client.query('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;');
  await client.end();
  await runMigrations(url);
}
