import type { AuthUser } from './requireAuth.js'

// Must match DEV_USER in src/lib/devAuth.ts.
export const DEV_USER: AuthUser = {
  id: 'dev-user',
  email: 'dev@bestbefore.local',
  name: 'Dev User',
}

let warnedInProduction = false

// Local-dev bypass, shared with the client via VITE_DISABLE_AUTH in .env.local.
// Read per request so tests can toggle it. Never honoured in production or on Vercel.
export function isAuthDisabled(): boolean {
  if (process.env.VITE_DISABLE_AUTH !== 'true') return false

  if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
    if (!warnedInProduction) {
      console.warn('VITE_DISABLE_AUTH is set in production; ignoring it.')
      warnedInProduction = true
    }
    return false
  }

  return true
}
