CREATE TABLE "seo_audits" (
	"id" text PRIMARY KEY NOT NULL,
	"input" text NOT NULL,
	"url" text NOT NULL,
	"domain" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"score" integer,
	"grade" text,
	"result" jsonb,
	"error" text,
	"email" text,
	"unlocked" boolean DEFAULT false NOT NULL,
	"user_id" text,
	"source" text,
	"ip_hash" text,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"unlocked_at" timestamp
);
--> statement-breakpoint
CREATE INDEX "seo_audits_domain_idx" ON "seo_audits" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "seo_audits_user_idx" ON "seo_audits" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "seo_audits_created_idx" ON "seo_audits" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "seo_audits_ip_hash_idx" ON "seo_audits" USING btree ("ip_hash");