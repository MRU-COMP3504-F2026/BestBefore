CREATE TABLE "signup_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"ip_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "signup_attempts_ip_hash_created_at_idx" ON "signup_attempts" USING btree ("ip_hash","created_at");