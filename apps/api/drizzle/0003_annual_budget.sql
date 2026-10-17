CREATE TYPE "public"."budget_line_kind" AS ENUM('income', 'expense', 'saving');--> statement-breakpoint
CREATE TABLE "budget_line_amounts" (
	"line_id" uuid NOT NULL,
	"month" integer NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	CONSTRAINT "budget_line_amounts_line_id_month_pk" PRIMARY KEY("line_id","month"),
	CONSTRAINT "budget_line_amounts_month" CHECK ("budget_line_amounts"."month" BETWEEN 1 AND 12)
);
--> statement-breakpoint
CREATE TABLE "budget_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"kind" "budget_line_kind" NOT NULL,
	"category_id" uuid,
	"income_source_id" uuid,
	"goal_id" uuid,
	"scope" "scope" NOT NULL,
	"owner_user_id" uuid,
	"nature" "expense_nature",
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "budget_lines_owner_scope" CHECK (("budget_lines"."scope" = 'personal' AND "budget_lines"."owner_user_id" IS NOT NULL) OR ("budget_lines"."scope" = 'shared' AND "budget_lines"."owner_user_id" IS NULL)),
	CONSTRAINT "budget_lines_target" CHECK (("budget_lines"."kind" = 'expense' AND "budget_lines"."category_id" IS NOT NULL) OR ("budget_lines"."kind" = 'income' AND "budget_lines"."income_source_id" IS NOT NULL) OR ("budget_lines"."kind" = 'saving' AND "budget_lines"."goal_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "budget_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"currency" "currency" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "budget_line_amounts" ADD CONSTRAINT "budget_line_amounts_line_id_budget_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."budget_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_plan_id_budget_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."budget_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_income_source_id_income_sources_id_fk" FOREIGN KEY ("income_source_id") REFERENCES "public"."income_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_goal_id_savings_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."savings_goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_plans" ADD CONSTRAINT "budget_plans_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "budget_lines_plan_idx" ON "budget_lines" USING btree ("plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_plans_household_year_uq" ON "budget_plans" USING btree ("household_id","year");--> statement-breakpoint
-- Move the monthly budgets into annual plans: one plan per household and year, one line per
-- category/owner, one amount per month.
INSERT INTO "budget_plans" ("household_id", "year", "currency")
SELECT DISTINCT ON (b."household_id", extract(year from b."month")::int)
  b."household_id", extract(year from b."month")::int, b."currency"
FROM "budgets" b
ORDER BY b."household_id", extract(year from b."month")::int, b."month" DESC;--> statement-breakpoint
INSERT INTO "budget_lines" ("plan_id", "kind", "category_id", "scope", "owner_user_id", "nature")
SELECT DISTINCT p."id", 'expense'::budget_line_kind, i."category_id", i."scope", i."owner_user_id", c."default_nature"
FROM "budget_items" i
JOIN "budgets" b ON b."id" = i."budget_id"
JOIN "budget_plans" p ON p."household_id" = b."household_id" AND p."year" = extract(year from b."month")::int
JOIN "categories" c ON c."id" = i."category_id";--> statement-breakpoint
INSERT INTO "budget_line_amounts" ("line_id", "month", "amount")
SELECT l."id", extract(month from b."month")::int, sum(i."planned_amount")
FROM "budget_items" i
JOIN "budgets" b ON b."id" = i."budget_id"
JOIN "budget_plans" p ON p."household_id" = b."household_id" AND p."year" = extract(year from b."month")::int
JOIN "budget_lines" l ON l."plan_id" = p."id" AND l."category_id" = i."category_id" AND l."scope" = i."scope"
  AND l."owner_user_id" IS NOT DISTINCT FROM i."owner_user_id"
GROUP BY l."id", extract(month from b."month")::int;
