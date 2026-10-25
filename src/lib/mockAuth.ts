// Mock auth responses for flows not yet backed by Neon Auth (password reset needs email).

export type AuthResult = { ok: true } | { ok: false; error: string }

export const MOCK_DELAY_MS = 500

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Always succeeds so the UI never reveals whether an account exists.
export async function mockForgotPassword(): Promise<AuthResult> {
  await delay(MOCK_DELAY_MS)
  return { ok: true }
}
