import { buildApp } from './app';
import { loadConfig } from './config';
import { createDb } from './db/client';
import { runMigrations } from './db/migrate';
import { runRecurring } from './jobs/recurring';
import { startScheduler } from './jobs/scheduler';

const config = loadConfig();

if (process.env.RUN_MIGRATIONS === 'true') {
  await runMigrations(config.DATABASE_URL);
}

const { db, pool } = createDb(config.DATABASE_URL);
const app = await buildApp({ config, db });
const stopScheduler = startScheduler(db, [{ name: 'recurring', everyMinutes: 60, run: (tx) => runRecurring(tx) }], app.log);

const shutdown = async () => {
  stopScheduler();
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.API_PORT, host: '0.0.0.0' });
