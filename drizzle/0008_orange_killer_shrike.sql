CREATE TABLE "gsc_daily" (
	"id" text PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"page" text DEFAULT '' NOT NULL,
	"query" text DEFAULT '' NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"ctr" double precision DEFAULT 0 NOT NULL,
	"position" double precision DEFAULT 0 NOT NULL,
	"pulled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "gsc_daily_date_idx" ON "gsc_daily" USING btree ("date");