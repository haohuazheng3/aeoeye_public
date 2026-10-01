CREATE TABLE "seo_quota" (
	"bucket" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"n" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "seo_audits" ADD COLUMN "progress" jsonb;--> statement-breakpoint
ALTER TABLE "seo_audits" ADD COLUMN "cached_from" text;--> statement-breakpoint
ALTER TABLE "seo_audits" ADD COLUMN "upgrade_state" text DEFAULT 'idle';--> statement-breakpoint
ALTER TABLE "seo_audits" ADD COLUMN "upgrade_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "seo_audits" ADD COLUMN "rerun_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "seo_audits" ADD COLUMN "paid_refresh_count" integer DEFAULT 0 NOT NULL;