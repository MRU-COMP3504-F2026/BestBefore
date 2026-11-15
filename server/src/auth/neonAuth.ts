import { createRemoteJWKSet } from 'jose'

type NeonAuthKeys = {
  // Neon Auth sets both `iss` and `aud` on its JWTs to the auth URL's origin.
  origin: string
  jwks: ReturnType<typeof createRemoteJWKSet>
}

let keys: NeonAuthKeys | undefined

// Lazily built so importing the app (e.g. in tests) doesn't require NEON_AUTH_URL.
// jose caches the fetched key set and refetches when it sees an unknown `kid`.
export function getNeonAuthKeys(): NeonAuthKeys {
  if (!keys) {
    const authUrl = process.env.NEON_AUTH_URL
    if (!authUrl) {
      throw new Error('NEON_AUTH_URL is not set')
    }
    const mismatched = mismatchedNeonUrls()
    if (mismatched.length > 0) {
      // Names only, never the URLs: DATABASE_URL holds a password.
      console.warn(
        `${mismatched.join(' and ')} not on the same Neon endpoint as NEON_AUTH_URL. Signed-in users ` +
          "won't be in this database, so saving their items fails. Use URLs from one Neon branch.",
      )
    }
    keys = {
      origin: new URL(authUrl).origin,
      jwks: createRemoteJWKSet(new URL(`${authUrl.replace(/\/$/, '')}/.well-known/jwks.json`)),
    }
  }
  return keys
}

// The Neon compute endpoint ("ep-...") a URL's host starts with, or null for any other host. The
// database host may add "-pooler"; the auth host is "<endpoint>.neonauth...".
function neonEndpoint(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.match(/^(ep-[a-z0-9-]+?)(?:-pooler)?\./)?.[1] ?? null
  } catch {
    return null
  }
}

// The names of the URLs that point at a different Neon endpoint (so branch) than NEON_AUTH_URL.
// Anything that isn't a Neon URL can't be compared and is left out.
export function mismatchedNeonUrls(env: NodeJS.ProcessEnv = process.env): string[] {
  const auth = neonEndpoint(env.NEON_AUTH_URL)
  if (!auth) return []
  return (['DATABASE_URL', 'VITE_NEON_AUTH_URL'] as const).filter((name) => {
    const endpoint = neonEndpoint(env[name])
    return endpoint !== null && endpoint !== auth
  })
}
