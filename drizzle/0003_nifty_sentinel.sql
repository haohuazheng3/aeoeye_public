CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"last_used_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "api_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"key_id" text NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"input" text,
	"audit_id" text,
	"status" text NOT NULL,
	"http_status" integer,
	"error" text,
	"duration_ms" integer,
	"cost_micro_usd" integer DEFAULT 0 NOT NULL,
	"measured_micro_usd" integer DEFAULT 0 NOT NULL,
	"estimated_micro_usd" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_breakdown" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "api_keys_user_idx" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "api_keys_hash_idx" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_requests_user_idx" ON "api_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "api_requests_key_idx" ON "api_requests" USING btree ("key_id");--> statement-breakpoint
CREATE INDEX "api_requests_created_idx" ON "api_requests" USING btree ("created_at");