import { createHash } from 'node:crypto'
import { and, count, eq, gt } from 'drizzle-orm'
import { db } from '../db/index.js'
import { signupAttempts } from '../db/schema.js'

export const SIGNUPS_PER_IP = 1
export const SIGNUP_WINDOW_MS = 24 * 60 * 60 * 1000

// Store a hash rather than the raw address.
function hashIp(ip: string) {
  return createHash('sha256').update(ip).digest('hex')
}

// Records the sign-up and returns true if this IP is still under its limit.
export async function consumeSignupSlot(ip: string): Promise<boolean> {
  const ipHash = hashIp(ip)
  const since = new Date(Date.now() - SIGNUP_WINDOW_MS)

  const [{ total }] = await db
    .select({ total: count() })
    .from(signupAttempts)
    .where(and(eq(signupAttempts.ipHash, ipHash), gt(signupAttempts.createdAt, since)))

  if (total >= SIGNUPS_PER_IP) return false

  await db.insert(signupAttempts).values({ ipHash })
  return true
}
