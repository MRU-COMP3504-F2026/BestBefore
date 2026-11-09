// In-memory per-user limits for the endpoints that spend third-party quota. Each serverless
// instance keeps its own counts, which is enough to stop runaway use during the beta.

export const IDENTIFY_PER_MINUTE = 6
export const IDENTIFY_PER_DAY = 60

// One lookup asks up to three product databases, and two of them have small quotas.
export const LOOKUP_PER_MINUTE = 10
export const LOOKUP_PER_DAY = 100

// Only counts requests that actually reach Gemini. The local engine has no limit.
export const EXPIRY_AI_PER_MINUTE = 6
export const EXPIRY_AI_PER_DAY = 60

const MINUTE_MS = 60 * 1000
const DAY_MS = 24 * 60 * MINUTE_MS

export type SlotResult = { ok: true; release: () => void } | { ok: false; reason: 'busy' | 'limit' }

function createLimiter(perMinute: number, perDay: number) {
  const history = new Map<string, number[]>()
  const inFlight = new Set<string>()

  return {
    // Claims a slot for one call. Rejects while the user already has one running.
    claim(userId: string, now = Date.now()): SlotResult {
      if (inFlight.has(userId)) return { ok: false, reason: 'busy' }

      const recent = (history.get(userId) ?? []).filter((at) => now - at < DAY_MS)
      const lastMinute = recent.filter((at) => now - at < MINUTE_MS).length
      if (recent.length >= perDay || lastMinute >= perMinute) {
        history.set(userId, recent)
        return { ok: false, reason: 'limit' }
      }

      recent.push(now)
      history.set(userId, recent)
      inFlight.add(userId)
      return { ok: true, release: () => inFlight.delete(userId) }
    },
    reset() {
      history.clear()
      inFlight.clear()
    },
  }
}

const identifyLimiter = createLimiter(IDENTIFY_PER_MINUTE, IDENTIFY_PER_DAY)
const lookupLimiter = createLimiter(LOOKUP_PER_MINUTE, LOOKUP_PER_DAY)
const expiryAiLimiter = createLimiter(EXPIRY_AI_PER_MINUTE, EXPIRY_AI_PER_DAY)

export const claimIdentifySlot = identifyLimiter.claim
export const claimLookupSlot = lookupLimiter.claim
export const claimExpiryAiSlot = expiryAiLimiter.claim

// For tests.
export const resetIdentifyLimits = identifyLimiter.reset
export const resetLookupLimits = lookupLimiter.reset
export const resetExpiryAiLimits = expiryAiLimiter.reset
