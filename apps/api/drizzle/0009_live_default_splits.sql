ALTER TABLE "expenses" ADD COLUMN "custom_split" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "income_entries" ADD COLUMN "custom_split" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Occurrences of fixed expenses with their own split keep it.
UPDATE "expenses" SET "custom_split" = true WHERE "scope" = 'shared' AND "recurring_expense_id" IN (SELECT "recurring_expense_id" FROM "recurring_expense_splits");
