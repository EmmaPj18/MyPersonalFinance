ALTER TYPE "public"."inbox_kind" ADD VALUE 'refund';--> statement-breakpoint
ALTER TABLE "transaction_inbox" ADD COLUMN "refund_expense_id" uuid;--> statement-breakpoint
ALTER TABLE "transaction_inbox" ADD CONSTRAINT "transaction_inbox_refund_expense_id_expenses_id_fk" FOREIGN KEY ("refund_expense_id") REFERENCES "public"."expenses"("id") ON DELETE set null ON UPDATE no action;