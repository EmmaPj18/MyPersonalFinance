import type { DbOrTx } from '../db/client';
import { auditLog } from '../db/schema';

export interface AuditEntry {
  householdId: string;
  userId: string | null;
  entity: string;
  entityId: string;
  action: string;
  before?: unknown;
  after?: unknown;
}

export const writeAudit = async (db: DbOrTx, entry: AuditEntry) => {
  await db.insert(auditLog).values({
    ...entry,
    before: entry.before ?? null,
    after: entry.after ?? null,
  });
};
