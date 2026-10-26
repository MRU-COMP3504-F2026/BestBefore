// In-memory per-user limits for the AI identify endpoint. Each serverless instance keeps its
// own counts, which is enough to stop runaway use during the beta.

export const IDENTIFY_PER_MINUTE = 6
export const IDENTIFY_PER_DAY = 60

const MINUTE_MS = 60 * 1000
const DAY_MS = 24 * 60 * MINUTE_MS

const history = new Map<string, number[]>()
const inFlight = new Set<string>()

export type SlotResult = { ok: true; release: () => void } | { ok: false; reason: 'busy' | 'limit' }

// Claims a slot for one identify call. Rejects while the user already has one running.
export function claimIdentifySlot(userId: string, now = Date.now()): SlotResult {
  if (inFlight.has(userId)) return { ok: false, reason: 'busy' }

  const recent = (history.get(userId) ?? []).filter((at) => now - at < DAY_MS)
  const lastMinute = recent.filter((at) => now - at < MINUTE_MS).length
  if (recent.length >= IDENTIFY_PER_DAY || lastMinute >= IDENTIFY_PER_MINUTE) {
    history.set(userId, recent)
    return { ok: false, reason: 'limit' }
  }

  recent.push(now)
  history.set(userId, recent)
  inFlight.add(userId)
  return { ok: true, release: () => inFlight.delete(userId) }
}

// For tests.
export function resetIdentifyLimits() {
  history.clear()
  inFlight.clear()
}
