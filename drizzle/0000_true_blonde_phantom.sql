CREATE TABLE "audits" (
	"id" text PRIMARY KEY NOT NULL,
	"input" text NOT NULL,
	"brand" text NOT NULL,
	"url" text,
	"domain" text NOT NULL,
	"category" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"source" text,
	"score" integer,
	"grade" text,
	"result" jsonb,
	"error" text,
	"email" text,
	"unlocked" boolean DEFAULT false NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"type" text NOT NULL,
	"audit_id" text,
	"brand" text,
	"name" text,
	"message" text,
	"meta" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitors" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"brand" text NOT NULL,
	"url" text,
	"domain" text NOT NULL,
	"cadence" text DEFAULT 'weekly' NOT NULL,
	"competitors" jsonb DEFAULT '[]'::jsonb,
	"last_audit_id" text,
	"last_score" integer,
	"next_run_at" timestamp,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"stripe_session_id" text,
	"stripe_payment_intent" text,
	"email" text NOT NULL,
	"product" text NOT NULL,
	"amount" integer NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"audit_id" text,
	"report_id" text,
	"user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"paid_at" timestamp,
	CONSTRAINT "orders_stripe_session_id_unique" UNIQUE("stripe_session_id")
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" text PRIMARY KEY NOT NULL,
	"audit_id" text NOT NULL,
	"order_id" text,
	"data" jsonb,
	"pdf_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"email" text NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"status" text DEFAULT 'incomplete' NOT NULL,
	"plan" text DEFAULT 'pro' NOT NULL,
	"price_id" text,
	"interval" text,
	"current_period_end" timestamp,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id")
);
--> statement-breakpoint
CREATE INDEX "audits_domain_idx" ON "audits" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "audits_user_idx" ON "audits" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audits_created_idx" ON "audits" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "monitors_user_idx" ON "monitors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "subs_user_idx" ON "subscriptions" USING btree ("user_id");