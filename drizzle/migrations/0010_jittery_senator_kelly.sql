ALTER TABLE "order_items" ADD COLUMN "pick_from_customer_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "source_customer_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "auto_return" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_pick_from_customer_id_customers_id_fk" FOREIGN KEY ("pick_from_customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_source_customer_id_customers_id_fk" FOREIGN KEY ("source_customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;