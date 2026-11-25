// Tests for the password reset wrappers (src/lib/authClient.ts) with auth turned on.
// The Neon Auth SDK is faked, so no real email is sent and no server is needed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requestPasswordReset, resetPassword } from '../lib/authClient'

const { requestPasswordResetMock, resetPasswordMock } = vi.hoisted(() => ({
  requestPasswordResetMock: vi.fn(),
  resetPasswordMock: vi.fn(),
}))

vi.mock('@neondatabase/auth', () => ({
  createAuthClient: () => ({
    requestPasswordReset: requestPasswordResetMock,
    resetPassword: resetPasswordMock,
  }),
}))
vi.mock('@neondatabase/auth/react/adapters', () => ({ BetterAuthReactAdapter: () => ({}) }))

// Make sure the dev bypass is off, whatever the local env says.
vi.mock('../lib/devAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/devAuth')>()),
  AUTH_DISABLED: false,
}))

describe('requestPasswordReset', () => {
  beforeEach(() => {
    requestPasswordResetMock.mockResolvedValue({ data: { status: true }, error: null })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('passes the email and redirect URL to Neon Auth', async () => {
    await expect(
      requestPasswordReset('you@example.com', 'https://app.test/reset-password'),
    ).resolves.toEqual({ ok: true })

    expect(requestPasswordResetMock).toHaveBeenCalledWith({
      email: 'you@example.com',
      redirectTo: 'https://app.test/reset-password',
    })
  })

  it('maps a rate-limit response to a friendly message', async () => {
    requestPasswordResetMock.mockResolvedValue({
      data: null,
      error: { status: 429, message: 'Too many requests' },
    })

    await expect(requestPasswordReset('you@example.com', 'https://app.test/reset-password')).resolves.toEqual({
      ok: false,
      error: 'Too many attempts. Please try again later.',
    })
  })
})

describe('resetPassword', () => {
  beforeEach(() => {
    resetPasswordMock.mockResolvedValue({ data: { status: true }, error: null })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('sends the token and new password to Neon Auth', async () => {
    await expect(resetPassword('token-123', 'correct-horse-1')).resolves.toEqual({ ok: true })

    expect(resetPasswordMock).toHaveBeenCalledWith({
      newPassword: 'correct-horse-1',
      token: 'token-123',
    })
  })

  it('maps an invalid or expired token to a friendly message', async () => {
    resetPasswordMock.mockResolvedValue({
      data: null,
      error: { code: 'INVALID_TOKEN', message: 'Invalid token', status: 400 },
    })

    await expect(resetPassword('stale', 'correct-horse-1')).resolves.toEqual({
      ok: false,
      error: 'This reset link is invalid or has expired. Request a new one.',
    })
  })

  it('maps a too-short password to a friendly message', async () => {
    resetPasswordMock.mockResolvedValue({
      data: null,
      error: { code: 'PASSWORD_TOO_SHORT', message: 'Password too short', status: 400 },
    })

    await expect(resetPassword('token-123', 'short')).resolves.toEqual({
      ok: false,
      error: 'Password must be at least 8 characters',
    })
  })
})
