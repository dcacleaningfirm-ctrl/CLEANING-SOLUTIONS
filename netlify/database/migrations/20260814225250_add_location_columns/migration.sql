ALTER TABLE "customers" ADD COLUMN "latitude" double precision;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "longitude" double precision;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "place_id" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "formatted_address" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "latitude" double precision;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "longitude" double precision;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "place_id" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "formatted_address" text;