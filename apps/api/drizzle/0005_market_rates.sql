CREATE TYPE "public"."fx_preferred_source" AS ENUM('bcrd', 'infodolar');--> statement-breakpoint
CREATE TYPE "public"."fx_side" AS ENUM('buy', 'sell', 'mid');--> statement-breakpoint
CREATE TYPE "public"."fx_source" AS ENUM('bcrd', 'ecb', 'erapi', 'infodolar');--> statement-breakpoint
CREATE TABLE "market_rates" (
	"source" "fx_source" NOT NULL,
	"entity" varchar(120) DEFAULT '' NOT NULL,
	"date" date NOT NULL,
	"from_currency" "currency" NOT NULL,
	"to_currency" "currency" NOT NULL,
	"buy" numeric(18, 8),
	"sell" numeric(18, 8),
	"mid" numeric(18, 8) NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_rates_source_entity_date_from_currency_to_currency_pk" PRIMARY KEY("source","entity","date","from_currency","to_currency"),
	CONSTRAINT "market_rates_positive" CHECK ("market_rates"."mid" > 0)
);
--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "fx_source" "fx_preferred_source" DEFAULT 'bcrd' NOT NULL;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "fx_entity" varchar(120);--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "fx_side" "fx_side" DEFAULT 'mid' NOT NULL;