ALTER TABLE "orders" ADD COLUMN "delivery_address" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_latitude" double precision;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_longitude" double precision;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_accuracy" double precision;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_captured_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_location_status" text;