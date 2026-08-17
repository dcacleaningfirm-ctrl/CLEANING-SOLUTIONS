CREATE TABLE "security_events" (
	"id" serial PRIMARY KEY,
	"event" text NOT NULL,
	"employee_id" integer,
	"employee_name" text,
	"employee_role" text,
	"actor_employee_id" integer,
	"actor_name" text,
	"actor_role" text,
	"detail" text,
	"outcome" text,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "must_change_pin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "pin_updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "failed_pin_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "last_failed_pin_at" timestamp;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "locked_until" timestamp;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "last_login_at" timestamp;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "created_by_employee_id" integer;--> statement-breakpoint
CREATE INDEX "security_events_created_idx" ON "security_events" ("created_at");--> statement-breakpoint
CREATE INDEX "security_events_employee_idx" ON "security_events" ("employee_id");--> statement-breakpoint
CREATE INDEX "security_events_event_idx" ON "security_events" ("event");--> statement-breakpoint
CREATE INDEX "security_events_ip_idx" ON "security_events" ("ip");--> statement-breakpoint
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_employee_id_employees_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id");--> statement-breakpoint
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_actor_employee_id_employees_id_fkey" FOREIGN KEY ("actor_employee_id") REFERENCES "employees"("id");