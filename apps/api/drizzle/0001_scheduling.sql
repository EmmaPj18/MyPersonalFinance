CREATE TYPE "public"."weekend_rule" AS ENUM('none', 'previous', 'next');--> statement-breakpoint
ALTER TYPE "public"."recurrence_frequency" ADD VALUE 'semimonthly' BEFORE 'monthly';--> statement-breakpoint
ALTER TYPE "public"."recurrence_frequency" ADD VALUE 'quarterly' BEFORE 'yearly';--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "auto_generated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "is_estimated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "timezone" varchar(64) DEFAULT 'America/Santo_Domingo' NOT NULL;--> statement-breakpoint
ALTER TABLE "income_entries" ADD COLUMN "scheduled_date" date;--> statement-breakpoint
ALTER TABLE "income_entries" ADD COLUMN "auto_generated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "income_entries" ADD COLUMN "is_estimated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "income_sources" ADD COLUMN "pay_day" integer;--> statement-breakpoint
ALTER TABLE "income_sources" ADD COLUMN "second_pay_day" integer;--> statement-breakpoint
ALTER TABLE "income_sources" ADD COLUMN "schedule_start_date" date;--> statement-breakpoint
ALTER TABLE "income_sources" ADD COLUMN "weekend_rule" "weekend_rule" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "income_sources" ADD COLUMN "expected_gross" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "income_sources" ADD COLUMN "auto_register" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "income_sources" ADD COLUMN "generated_through" date;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD COLUMN "second_due_day" integer;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD COLUMN "weekend_rule" "weekend_rule" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD COLUMN "auto_pay" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD COLUMN "paid_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD COLUMN "generated_through" date;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_paid_by_user_id_users_id_fk" FOREIGN KEY ("paid_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "income_entries_scheduled_uq" ON "income_entries" USING btree ("source_id","scheduled_date");--> statement-breakpoint
-- Fixed expenses are now registered automatically on their due date: occurrences already
-- generated up to today become paid, future pending ones are dropped (they are shown as
-- projections and created when their date arrives).
UPDATE "expenses" SET "auto_generated" = true WHERE "recurring_expense_id" IS NOT NULL;--> statement-breakpoint
UPDATE "expenses" SET "status" = 'paid', "paid_by_user_id" = coalesce("paid_by_user_id", "owner_user_id", "created_by")
  WHERE "recurring_expense_id" IS NOT NULL AND "status" = 'pending'
    AND "date" <= (now() AT TIME ZONE 'America/Santo_Domingo')::date;--> statement-breakpoint
DELETE FROM "expenses" WHERE "recurring_expense_id" IS NOT NULL AND "status" = 'pending'
  AND "date" > (now() AT TIME ZONE 'America/Santo_Domingo')::date;--> statement-breakpoint
UPDATE "recurring_expenses" SET "generated_through" = (now() AT TIME ZONE 'America/Santo_Domingo')::date;
