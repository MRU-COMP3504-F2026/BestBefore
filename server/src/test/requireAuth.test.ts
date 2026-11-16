// #187: requireAuth against real signed JWTs, with a local key set standing in for Neon Auth's JWKS.
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose'
import request from 'supertest'
import { app } from '../app.js'
import { mismatchedNeonUrls } from '../auth/neonAuth.js'

const ORIGIN = 'https://ep-quiet-sun-123456.neonauth.c-7.us-east-2.aws.neon.tech'
const USER_ID = '6b6d7eaa-7675-4b0a-8942-66ffeb0830a3'

const { keys } = vi.hoisted(() => ({ keys: { jwks: [] as JWK[] } }))

vi.mock('../auth/neonAuth.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth/neonAuth.js')>()),
  getNeonAuthKeys: () => ({ origin: ORIGIN, jwks: createLocalJWKSet({ keys: keys.jwks }) }),
}))

let privateKey: CryptoKey

beforeAll(async () => {
  const pair = await generateKeyPair('EdDSA', { extractable: true })
  privateKey = pair.privateKey
  keys.jwks = [{ ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'EdDSA' }]
})

function token({ issuer = ORIGIN, expires = '15m' }: { issuer?: string; expires?: string | number } = {}) {
  return new SignJWT({ email: 'dev@devtest.ca' })
    .setProtectedHeader({ alg: 'EdDSA', kid: 'test' })
    .setSubject(USER_ID)
    .setIssuer(issuer)
    .setAudience(issuer)
    .setIssuedAt()
    .setExpirationTime(expires)
    .sign(privateKey)
}

const me = async (jwt: string) => request(app).get('/api/me').set('Authorization', `Bearer ${jwt}`)

describe('requireAuth with a Neon Auth JWT', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('accepts a token from this auth URL and takes the user from its subject', async () => {
    const response = await me(await token())

    expect(response.status).toBe(200)
    expect(response.body.user).toEqual({ id: USER_ID, email: 'dev@devtest.ca' })
  })

  it("rejects another Neon branch's token and logs which claim failed, not the token", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const jwt = await token({ issuer: 'https://ep-other-branch-999.neonauth.c-7.us-east-2.aws.neon.tech' })

    const response = await me(jwt)

    expect(response.status).toBe(401)
    expect(warn).toHaveBeenCalledWith('Auth rejected: ERR_JWT_CLAIM_VALIDATION_FAILED (iss)')
    expect(JSON.stringify(warn.mock.calls)).not.toContain(jwt)
  })

  it('rejects an expired token and says so', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const response = await me(await token({ expires: Math.floor(Date.now() / 1000) - 60 }))

    expect(response.status).toBe(401)
    expect(warn).toHaveBeenCalledWith('Auth rejected: ERR_JWT_EXPIRED (exp)')
  })
})

describe('mismatchedNeonUrls', () => {
  const AUTH = `${ORIGIN}/neondb/auth`

  it('passes URLs from one Neon endpoint, pooled or not', () => {
    expect(
      mismatchedNeonUrls({
        NEON_AUTH_URL: AUTH,
        VITE_NEON_AUTH_URL: AUTH,
        DATABASE_URL: 'postgresql://user:secret@ep-quiet-sun-123456-pooler.c-7.us-east-2.aws.neon.tech/neondb',
      }),
    ).toEqual([])
  })

  it('names, without values, a database or browser URL on another endpoint', () => {
    expect(
      mismatchedNeonUrls({
        NEON_AUTH_URL: AUTH,
        VITE_NEON_AUTH_URL: 'https://ep-other-branch-999.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth',
        DATABASE_URL: 'postgresql://user:secret@ep-other-branch-999.c-7.us-east-2.aws.neon.tech/neondb',
      }),
    ).toEqual(['DATABASE_URL', 'VITE_NEON_AUTH_URL'])
  })

  it('leaves out what it cannot compare', () => {
    expect(mismatchedNeonUrls({ NEON_AUTH_URL: AUTH, DATABASE_URL: 'postgres://localhost:5432/test' })).toEqual([])
    expect(mismatchedNeonUrls({ DATABASE_URL: 'postgresql://u:p@ep-a-1.aws.neon.tech/db' })).toEqual([])
    expect(mismatchedNeonUrls({ NEON_AUTH_URL: 'not a url', DATABASE_URL: 'postgresql://u:p@ep-a-1.x/db' })).toEqual(
      [],
    )
  })
})
