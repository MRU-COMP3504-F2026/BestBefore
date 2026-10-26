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
    keys = {
      origin: new URL(authUrl).origin,
      jwks: createRemoteJWKSet(new URL(`${authUrl.replace(/\/$/, '')}/.well-known/jwks.json`)),
    }
  }
  return keys
}
