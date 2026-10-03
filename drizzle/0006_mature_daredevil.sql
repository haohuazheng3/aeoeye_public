CREATE TABLE "seo_gsc_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"domain" text NOT NULL,
	"user_id" text NOT NULL,
	"audit_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"property" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "seo_audits" ADD COLUMN "target_keywords" jsonb;--> statement-breakpoint
ALTER TABLE "seo_audits" ADD COLUMN "target_changes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "seo_audits" ADD COLUMN "gsc_property" text;--> statement-breakpoint
CREATE INDEX "seo_gsc_claims_domain_idx" ON "seo_gsc_claims" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "seo_gsc_claims_user_idx" ON "seo_gsc_claims" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "seo_gsc_claims_audit_idx" ON "seo_gsc_claims" USING btree ("audit_id");