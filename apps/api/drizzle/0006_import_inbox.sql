CREATE TYPE "public"."direction" AS ENUM('debit', 'credit');--> statement-breakpoint
CREATE TYPE "public"."inbox_kind" AS ENUM('expense', 'income', 'transfer', 'ignore');--> statement-breakpoint
CREATE TYPE "public"."inbox_source" AS ENUM('csv', 'xlsx', 'email');--> statement-breakpoint
CREATE TYPE "public"."inbox_status" AS ENUM('pending', 'imported', 'ignored');--> statement-breakpoint
CREATE TABLE "account_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"from_account_id" uuid NOT NULL,
	"to_account_id" uuid NOT NULL,
	"date" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" "currency" NOT NULL,
	"to_amount" numeric(14, 2),
	"description" varchar(255),
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_transfers_distinct" CHECK ("account_transfers"."from_account_id" <> "account_transfers"."to_account_id"),
	CONSTRAINT "account_transfers_positive" CHECK ("account_transfers"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "categorization_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"pattern" varchar(255) NOT NULL,
	"kind" "inbox_kind" NOT NULL,
	"category_id" uuid,
	"income_source_id" uuid,
	"transfer_account_id" uuid,
	"scope" "scope" DEFAULT 'shared' NOT NULL,
	"owner_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"source" "inbox_source" NOT NULL,
	"file_name" varchar(255),
	"row_count" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"mapping" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_inbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"source" "inbox_source" NOT NULL,
	"batch_id" uuid,
	"external_ref" varchar(255),
	"dedupe_hash" varchar(64) NOT NULL,
	"date" date NOT NULL,
	"description" varchar(255) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" "currency" NOT NULL,
	"direction" "direction" NOT NULL,
	"account_id" uuid,
	"kind" "inbox_kind" NOT NULL,
	"category_id" uuid,
	"income_source_id" uuid,
	"transfer_account_id" uuid,
	"scope" "scope" DEFAULT 'shared' NOT NULL,
	"owner_user_id" uuid,
	"rule_id" uuid,
	"duplicate_of_expense_id" uuid,
	"raw" jsonb,
	"status" "inbox_status" DEFAULT 'pending' NOT NULL,
	"expense_id" uuid,
	"income_entry_id" uuid,
	"transfer_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_inbox_amount_positive" CHECK ("transaction_inbox"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "account_transfers" ADD CONSTRAINT "account_transfers_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_transfers" ADD CONSTRAINT "account_transfers_from_account_id_accounts_id_fk" FOREIGN KEY ("from_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_transfers" ADD CONSTRAINT "account_transfers_to_account_id_accounts_id_fk" FOREIGN KEY ("to_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_transfers" ADD CONSTRAINT "account_transfers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categorization_rules" ADD CONSTRAINT "categorization_rules_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categorization_rules" ADD CONSTRAINT "categorization_rules_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categorization_rules" ADD CONSTRAINT "categorization_rules_income_source_id_income_sources_id_fk" FOREIGN KEY ("income_source_id") REFERENCES "public"."income_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categorization_rules" ADD CONSTRAINT "categorization_rules_transfer_account_id_accounts_id_fk" FOREIGN KEY ("transfer_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categorization_rules" ADD CONSTRAINT "categorization_rules_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_profiles" ADD CONSTRAINT "import_profiles_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_inbox" ADD CONSTRAINT "transaction_inbox_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_inbox" ADD CONSTRAINT "transaction_inbox_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_inbox" ADD CONSTRAINT "transaction_inbox_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_inbox" ADD CONSTRAINT "transaction_inbox_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_inbox" ADD CONSTRAINT "transaction_inbox_income_source_id_income_sources_id_fk" FOREIGN KEY ("income_source_id") REFERENCES "public"."income_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_inbox" ADD CONSTRAINT "transaction_inbox_transfer_account_id_accounts_id_fk" FOREIGN KEY ("transfer_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_inbox" ADD CONSTRAINT "transaction_inbox_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_inbox" ADD CONSTRAINT "transaction_inbox_rule_id_categorization_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."categorization_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_inbox" ADD CONSTRAINT "transaction_inbox_duplicate_of_expense_id_expenses_id_fk" FOREIGN KEY ("duplicate_of_expense_id") REFERENCES "public"."expenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_inbox" ADD CONSTRAINT "transaction_inbox_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_inbox" ADD CONSTRAINT "transaction_inbox_income_entry_id_income_entries_id_fk" FOREIGN KEY ("income_entry_id") REFERENCES "public"."income_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_inbox" ADD CONSTRAINT "transaction_inbox_transfer_id_account_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."account_transfers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_inbox" ADD CONSTRAINT "transaction_inbox_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_transfers_household_idx" ON "account_transfers" USING btree ("household_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "categorization_rules_household_pattern_uq" ON "categorization_rules" USING btree ("household_id","pattern");--> statement-breakpoint
CREATE UNIQUE INDEX "import_profiles_household_name_uq" ON "import_profiles" USING btree ("household_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_inbox_dedupe_uq" ON "transaction_inbox" USING btree ("household_id","dedupe_hash");--> statement-breakpoint
CREATE INDEX "transaction_inbox_status_idx" ON "transaction_inbox" USING btree ("household_id","status","date");