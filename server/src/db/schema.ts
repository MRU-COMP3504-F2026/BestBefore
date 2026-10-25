import { index, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core'

// Neon Auth owns users and sessions in the `neon_auth` schema. App tables live in
// `public` and should reference users by `neon_auth.user.id` only.

// Sign-ups allowed by the Neon Auth `user.before_create` webhook, for per-IP rate limiting.
export const signupAttempts = pgTable(
  'signup_attempts',
  {
    id: serial('id').primaryKey(),
    ipHash: text('ip_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('signup_attempts_ip_hash_created_at_idx').on(table.ipHash, table.createdAt)],
)
