CREATE TABLE IF NOT EXISTS "error_events" (
	"id" text PRIMARY KEY NOT NULL,
	"fingerprint" text NOT NULL,
	"name" text NOT NULL,
	"message" text,
	"stack" text,
	"route" text,
	"level" text DEFAULT 'error' NOT NULL,
	"source" text DEFAULT 'server' NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp,
	"sample_meta" jsonb,
	CONSTRAINT "error_events_fingerprint_unique" UNIQUE("fingerprint")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "events" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"visitor_id" text,
	"user_id" text,
	"type" text NOT NULL,
	"path" text,
	"referrer" text,
	"source" text,
	"meta" jsonb,
	"ip_city" text,
	"is_self" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audits" ADD COLUMN IF NOT EXISTS "pdf_sent_at" timestamp;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "error_events_resolved_idx" ON "error_events" USING btree ("resolved");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "error_events_last_seen_idx" ON "error_events" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_session_idx" ON "events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_type_idx" ON "events" USING btree ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_created_idx" ON "events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_user_idx" ON "events" USING btree ("user_id");