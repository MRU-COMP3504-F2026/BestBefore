CREATE TABLE "inventory_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"brand" text,
	"barcode" text,
	"category" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit" text,
	"purchase_date" date NOT NULL,
	"best_before" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "neon_auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_items_user_id_best_before_idx" ON "inventory_items" USING btree ("user_id","best_before");