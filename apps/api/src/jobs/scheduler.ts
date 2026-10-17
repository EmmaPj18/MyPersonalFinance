import { sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Database, DbOrTx } from '../db/client';

export interface Job {
  name: string;
  /** Minimum minutes between runs. */
  everyMinutes: number;
  run: (db: DbOrTx) => Promise<unknown>;
}

const TICK_MS = 5 * 60 * 1000;

/** Stable 32-bit key for pg advisory locks. */
const lockKey = (name: string) => [...name].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);

/**
 * In-process scheduler: every few minutes runs the jobs that are due. Each run takes a
 * Postgres transaction-level advisory lock, so only one API instance executes a job at a time.
 */
export const startScheduler = (db: Database, jobs: Job[], log: FastifyBaseLogger) => {
  const lastRun = new Map<string, number>();
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      for (const job of jobs) {
        if (Date.now() - (lastRun.get(job.name) ?? 0) < job.everyMinutes * 60_000) continue;
        lastRun.set(job.name, Date.now());
        try {
          const result = await db.transaction(async (tx) => {
            const locked = await tx.execute<{ ok: boolean }>(sql`select pg_try_advisory_xact_lock(${lockKey(job.name)}) as ok`);
            return locked.rows[0]?.ok ? job.run(tx) : 'skipped (locked)';
          });
          log.info({ job: job.name, result }, 'job finished');
        } catch (err) {
          log.error({ job: job.name, err }, 'job failed');
        }
      }
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), TICK_MS);
  return () => clearInterval(timer);
};
