CREATE TABLE "items" (
	"barcode" text PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_barcode_gtin14_check" CHECK ("items"."barcode" ~ '^[0-9]{14}$')
);
