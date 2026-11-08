-- Lets a product confirmed from an AI Vision photo be shared without a barcode. Every existing row
-- keeps its barcode, payload and shelf life; it only gains an id. Barcodes stay unique, so lookups
-- and ON CONFLICT ("barcode") behave as before.
-- "items_pkey" is Postgres's name for the key 0002 created inline. If it differs, this fails
-- before anything changes: check with
--   SELECT constraint_name FROM information_schema.table_constraints
--   WHERE table_schema = 'public' AND table_name = 'items' AND constraint_type = 'PRIMARY KEY';
-- Unique before the key goes, so barcodes are never unguarded.
ALTER TABLE "items" ADD CONSTRAINT "items_barcode_unique" UNIQUE("barcode");--> statement-breakpoint
ALTER TABLE "items" DROP CONSTRAINT "items_pkey";--> statement-breakpoint
ALTER TABLE "items" ALTER COLUMN "barcode" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "id" serial PRIMARY KEY NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "photo_key" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "photo_alias" text;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_photo_key_unique" UNIQUE("photo_key");--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_one_key_check" CHECK (("items"."barcode" IS NULL) <> ("items"."photo_key" IS NULL));--> statement-breakpoint
CREATE INDEX "items_photo_alias_idx" ON "items" USING btree ("photo_alias");
