import { createAuthClient } from '@neondatabase/auth'
import { BetterAuthReactAdapter } from '@neondatabase/auth/react/adapters'

// Neon Auth (managed Better Auth). The browser talks to the Neon Auth URL directly;
// our Express API only verifies the JWTs it issues (see server/src/auth).
export const authClient = createAuthClient(import.meta.env.VITE_NEON_AUTH_URL, {
  adapter: BetterAuthReactAdapter(),
})

export type AuthResult = { ok: true } | { ok: false; error: string }

type AuthError = { code?: string; message?: string; status?: number } | null

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'Invalid email or password',
  USER_ALREADY_EXISTS: 'An account with this email already exists',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'An account with this email already exists',
}

export function toAuthResult(error: AuthError): AuthResult {
  if (!error) return { ok: true }
  if (error.status === 429) {
    return { ok: false, error: 'Too many attempts. Please try again later.' }
  }
  const message = (error.code && ERROR_MESSAGES[error.code]) || error.message
  return { ok: false, error: message || 'Something went wrong. Please try again.' }
}

export async function signIn(email: string, password: string): Promise<AuthResult> {
  const { error } = await authClient.signIn.email({ email, password })
  return toAuthResult(error)
}

export async function signUp(email: string, password: string): Promise<AuthResult> {
  // The register form has no name field; Better Auth requires one.
  const name = email.split('@')[0]
  const { error } = await authClient.signUp.email({ email, password, name })
  return toAuthResult(error)
}

export async function signOut(): Promise<AuthResult> {
  const { error } = await authClient.signOut()
  return toAuthResult(error)
}

// Short-lived (15 min) JWT for authenticating requests to our own API.
export async function getApiToken(): Promise<string | null> {
  const { data } = await authClient.token()
  return data?.token ?? null
}
