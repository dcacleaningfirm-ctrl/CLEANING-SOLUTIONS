CREATE TABLE "campaign_events" (
	"id" serial PRIMARY KEY,
	"campaign_id" integer NOT NULL,
	"recipient_id" integer,
	"customer_id" integer,
	"channel" text,
	"kind" text NOT NULL,
	"detail" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "campaign_recipients" (
	"id" serial PRIMARY KEY,
	"campaign_id" integer NOT NULL,
	"customer_id" integer,
	"channel" text NOT NULL,
	"address" text NOT NULL,
	"token" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"error" text,
	"provider" text,
	"provider_ref" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"queued_at" timestamp DEFAULT now(),
	"sent_at" timestamp,
	"delivered_at" timestamp,
	"failed_at" timestamp,
	"clicked_at" timestamp,
	"click_count" integer DEFAULT 0 NOT NULL,
	"opted_out_at" timestamp,
	"booked_at" timestamp,
	"job_id" integer,
	"revenue_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" serial PRIMARY KEY,
	"name" text NOT NULL,
	"promotion_title" text,
	"sms_body" text,
	"email_subject" text,
	"email_body" text,
	"promotion_url" text,
	"promo_code" text,
	"expires_at" timestamp,
	"sms_enabled" boolean DEFAULT false NOT NULL,
	"email_enabled" boolean DEFAULT false NOT NULL,
	"audience" jsonb,
	"status" text DEFAULT 'draft' NOT NULL,
	"scheduled_for" timestamp,
	"audience_size" integer DEFAULT 0 NOT NULL,
	"created_by" integer,
	"created_by_name" text,
	"queued_at" timestamp,
	"started_at" timestamp,
	"sent_at" timestamp,
	"cancelled_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "marketing_consent_events" (
	"id" serial PRIMARY KEY,
	"customer_id" integer,
	"channel" text NOT NULL,
	"action" text NOT NULL,
	"status" text NOT NULL,
	"source" text,
	"detail" text,
	"address" text,
	"actor_employee_id" integer,
	"actor_name" text,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "marketing_suppressions" (
	"id" serial PRIMARY KEY,
	"channel" text NOT NULL,
	"address" text NOT NULL,
	"reason" text DEFAULT 'opted_out' NOT NULL,
	"source" text,
	"customer_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "sms_consent_status" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "sms_consent_source" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "sms_consent_at" timestamp;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "sms_opted_out_at" timestamp;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "email_consent_status" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "email_consent_source" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "email_consent_at" timestamp;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "email_opted_out_at" timestamp;--> statement-breakpoint
CREATE INDEX "campaign_events_campaign_idx" ON "campaign_events" ("campaign_id");--> statement-breakpoint
CREATE INDEX "campaign_events_recipient_idx" ON "campaign_events" ("recipient_id");--> statement-breakpoint
CREATE INDEX "campaign_events_kind_idx" ON "campaign_events" ("kind");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_recipients_token_idx" ON "campaign_recipients" ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_recipients_unique_idx" ON "campaign_recipients" ("campaign_id","channel","address");--> statement-breakpoint
CREATE INDEX "campaign_recipients_campaign_idx" ON "campaign_recipients" ("campaign_id");--> statement-breakpoint
CREATE INDEX "campaign_recipients_status_idx" ON "campaign_recipients" ("status");--> statement-breakpoint
CREATE INDEX "campaign_recipients_customer_idx" ON "campaign_recipients" ("customer_id");--> statement-breakpoint
CREATE INDEX "campaigns_status_idx" ON "campaigns" ("status");--> statement-breakpoint
CREATE INDEX "campaigns_scheduled_idx" ON "campaigns" ("scheduled_for");--> statement-breakpoint
CREATE INDEX "customers_sms_consent_idx" ON "customers" ("sms_consent_status");--> statement-breakpoint
CREATE INDEX "customers_email_consent_idx" ON "customers" ("email_consent_status");--> statement-breakpoint
CREATE INDEX "customers_zip_idx" ON "customers" ("zip");--> statement-breakpoint
CREATE INDEX "marketing_consent_customer_idx" ON "marketing_consent_events" ("customer_id");--> statement-breakpoint
CREATE INDEX "marketing_consent_created_idx" ON "marketing_consent_events" ("created_at");--> statement-breakpoint
CREATE INDEX "marketing_consent_channel_idx" ON "marketing_consent_events" ("channel");--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_suppressions_address_idx" ON "marketing_suppressions" ("channel","address");--> statement-breakpoint
ALTER TABLE "campaign_events" ADD CONSTRAINT "campaign_events_campaign_id_campaigns_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id");--> statement-breakpoint
ALTER TABLE "campaign_events" ADD CONSTRAINT "campaign_events_recipient_id_campaign_recipients_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "campaign_recipients"("id");--> statement-breakpoint
ALTER TABLE "campaign_events" ADD CONSTRAINT "campaign_events_customer_id_customers_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id");--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaign_id_campaigns_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id");--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_customer_id_customers_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id");--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_job_id_jobs_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id");--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_employees_id_fkey" FOREIGN KEY ("created_by") REFERENCES "employees"("id");--> statement-breakpoint
ALTER TABLE "marketing_consent_events" ADD CONSTRAINT "marketing_consent_events_customer_id_customers_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id");--> statement-breakpoint
ALTER TABLE "marketing_consent_events" ADD CONSTRAINT "marketing_consent_events_actor_employee_id_employees_id_fkey" FOREIGN KEY ("actor_employee_id") REFERENCES "employees"("id");--> statement-breakpoint
ALTER TABLE "marketing_suppressions" ADD CONSTRAINT "marketing_suppressions_customer_id_customers_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id");