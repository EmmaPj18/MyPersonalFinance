ALTER TABLE "source_deduction_templates" DROP CONSTRAINT "source_deduction_templates_source_id_deduction_type_id_pk";--> statement-breakpoint
ALTER TABLE "source_deduction_templates" ADD COLUMN "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "source_deduction_templates" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "source_deduction_templates_source_idx" ON "source_deduction_templates" USING btree ("source_id");