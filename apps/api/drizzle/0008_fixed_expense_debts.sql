ALTER TABLE "debt_payments" DROP CONSTRAINT "debt_payments_expense_id_expenses_id_fk";
--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD COLUMN "debt_id" uuid;--> statement-breakpoint
ALTER TABLE "debt_payments" ADD CONSTRAINT "debt_payments_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_debt_id_debts_id_fk" FOREIGN KEY ("debt_id") REFERENCES "public"."debts"("id") ON DELETE set null ON UPDATE no action;