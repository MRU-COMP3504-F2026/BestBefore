-- Pictures for inventory items. Only adds nullable columns and a check every existing row passes
-- (all four null), so no data changes. A user's AI Vision photo lives on their own row, never in
-- the shared "items" table.
ALTER TABLE "inventory_items" ADD COLUMN "image_source" text;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "photo" "bytea";--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "photo_type" text;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_image_check" CHECK (("inventory_items"."image_source" is null and "inventory_items"."image_url" is null and "inventory_items"."photo" is null and "inventory_items"."photo_type" is null)
        or ("inventory_items"."image_source" = 'product' and "inventory_items"."image_url" is not null and "inventory_items"."photo" is null and "inventory_items"."photo_type" is null)
        or ("inventory_items"."image_source" = 'photo' and "inventory_items"."image_url" is null and "inventory_items"."photo" is not null and "inventory_items"."photo_type" is not null
          and octet_length("inventory_items"."photo") <= 786432));