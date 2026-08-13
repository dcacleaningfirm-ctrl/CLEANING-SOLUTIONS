CREATE TABLE "job_items" (
	"id" serial PRIMARY KEY,
	"job_id" integer NOT NULL,
	"kind" text DEFAULT 'service' NOT NULL,
	"label" text NOT NULL,
	"detail" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price_cents" integer DEFAULT 0 NOT NULL,
	"amount_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "job_items_job_idx" ON "job_items" ("job_id");--> statement-breakpoint
ALTER TABLE "job_items" ADD CONSTRAINT "job_items_job_id_jobs_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id");