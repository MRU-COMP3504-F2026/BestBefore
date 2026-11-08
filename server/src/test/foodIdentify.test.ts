import request from 'supertest'
import { ApiError } from '@google/genai'
import { app } from '../app.js'
import { normalizeGeminiFood } from '../food/foodSchema.js'
import { GEMINI_TIMEOUT_MS } from '../food/gemini.js'
import { IDENTIFY_PER_MINUTE, resetIdentifyLimits } from '../food/rateLimit.js'
import { MAX_IMAGE_BYTES } from '../food/routes.js'
import { verifyPhotoProvenance } from '../food/photoItems.js'
import { DEV_USER } from '../auth/devAuth.js'

// Gemini is always mocked: tests never spend real API quota.
const generateContent = vi.hoisted(() => vi.fn())

vi.mock('@google/genai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@google/genai')>()),
  GoogleGenAI: class {
    models = { generateContent }
  },
}))

const IMAGE = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])

const BANANA = {
  identified: true,
  name: 'Banana',
  brand: null,
  category: 'Fresh fruit',
  quantity: 1,
  unit: 'piece',
  ripeness: 'ripe',
}

function geminiReturns(json: unknown) {
  generateContent.mockResolvedValue({ text: JSON.stringify(json) })
}

function identify(body: Buffer = IMAGE, type = 'image/jpeg') {
  return request(app).post('/api/food/identify').set('Content-Type', type).send(body)
}

describe('POST /api/food/identify', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetIdentifyLimits()
    vi.stubEnv('VITE_DISABLE_AUTH', 'true')
    vi.stubEnv('GEMINI_API_KEY', 'test-key')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  it('requires auth', async () => {
    vi.stubEnv('VITE_DISABLE_AUTH', 'false')

    const response = await identify()

    expect(response.status).toBe(401)
    expect(generateContent).not.toHaveBeenCalled()
  })

  it('returns the identified food', async () => {
    geminiReturns(BANANA)

    const response = await identify()

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      identified: true,
      food: { name: 'Banana', brand: null, category: 'Fresh fruit', quantity: 1, unit: 'piece', ripeness: 'ripe' },
      provenance: expect.any(String),
    })
    const call = generateContent.mock.lastCall![0]
    expect(call.contents[0].parts[0].inlineData).toEqual({
      mimeType: 'image/jpeg',
      data: IMAGE.toString('base64'),
    })
  })

  it('signs the identification for this user, with only the name Gemini gave it', async () => {
    geminiReturns({ ...BANANA, brand: 'Dole' })

    const { provenance } = (await identify()).body

    // What Gemini called it, so a save can't claim another food. No key, and nothing the user typed.
    expect(verifyPhotoProvenance(provenance, DEV_USER.id)).toEqual({ alias: 'v1|banana|dole' })
    expect(verifyPhotoProvenance(provenance, 'someone-else')).toBeNull()
    const claims = Buffer.from(provenance.split('.')[0], 'base64url').toString('utf8')
    expect(claims).not.toMatch(/test-key/)
  })

  it('keeps a brand Gemini read off the package', async () => {
    geminiReturns({ ...BANANA, name: 'Greek yogurt', brand: ' Chobani ', category: 'Dairy' })

    const response = await identify()

    expect(response.body.food).toMatchObject({ name: 'Greek yogurt', brand: 'Chobani' })
    expect(generateContent.mock.lastCall![0].contents[0].parts[1].text).toMatch(/Never guess one/)
  })

  it('returns an unsuccessful identification for unclear photos', async () => {
    geminiReturns({ ...BANANA, identified: false, name: null })

    const response = await identify()

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ identified: false })
    expect(response.body).not.toHaveProperty('provenance')
  })

  it('rejects unsupported image types without calling Gemini', async () => {
    const response = await identify(IMAGE, 'image/gif')

    expect(response.status).toBe(415)
    expect(generateContent).not.toHaveBeenCalled()
  })

  it('rejects oversized images without calling Gemini', async () => {
    const response = await identify(Buffer.alloc(MAX_IMAGE_BYTES + 1))

    expect(response.status).toBe(413)
    expect(response.body.error).toMatch(/too large/)
    expect(generateContent).not.toHaveBeenCalled()
  })

  it('returns 503 when no API key is configured', async () => {
    vi.stubEnv('GEMINI_API_KEY', '')

    const response = await identify()

    expect(response.status).toBe(503)
  })

  it('returns 502 for a response that fails validation', async () => {
    geminiReturns({ identified: 'yes', name: 42 })

    const response = await identify()

    expect(response.status).toBe(502)
  })

  it('returns 429 when Gemini is rate limited, without retrying', async () => {
    generateContent.mockRejectedValue(new ApiError({ message: 'quota', status: 429 }))

    const response = await identify()

    expect(response.status).toBe(429)
    expect(generateContent).toHaveBeenCalledTimes(1)
  })

  it('returns 503 when the Gemini model is overloaded, without retrying', async () => {
    generateContent.mockRejectedValue(new ApiError({ message: 'high demand', status: 503 }))

    const response = await identify()

    expect(response.status).toBe(503)
    expect(response.body.error).toMatch(/overloaded/)
    expect(generateContent).toHaveBeenCalledTimes(1)
  })

  it('returns 502 for other Gemini errors, without retrying', async () => {
    generateContent.mockRejectedValue(new Error('boom'))

    const response = await identify()

    expect(response.status).toBe(502)
    expect(generateContent).toHaveBeenCalledTimes(1)
  })

  it('times out a slow Gemini call', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    generateContent.mockImplementation(
      ({ config }: { config: { abortSignal: AbortSignal } }) =>
        new Promise((_resolve, reject) => {
          config.abortSignal.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    )

    const pending = identify().then((response) => response)
    await vi.waitFor(() => expect(generateContent).toHaveBeenCalled())
    await vi.advanceTimersByTimeAsync(GEMINI_TIMEOUT_MS)
    const response = await pending

    expect(response.status).toBe(504)
  })

  it('rate limits each user', async () => {
    geminiReturns(BANANA)
    for (let i = 0; i < IDENTIFY_PER_MINUTE; i++) {
      expect((await identify()).status).toBe(200)
    }

    const response = await identify()

    expect(response.status).toBe(429)
    expect(response.body.error).toMatch(/limit/)
    expect(generateContent).toHaveBeenCalledTimes(IDENTIFY_PER_MINUTE)
  })

  it('rejects a second request while one is still running', async () => {
    let finish!: (value: unknown) => void
    generateContent.mockReturnValue(new Promise((resolve) => (finish = resolve)))

    const first = identify().then((response) => response)
    await vi.waitFor(() => expect(generateContent).toHaveBeenCalled())
    const second = await identify()
    finish({ text: JSON.stringify(BANANA) })

    expect(second.status).toBe(429)
    expect((await first).status).toBe(200)
    expect(generateContent).toHaveBeenCalledTimes(1)
  })

  it('never logs the image or API key', async () => {
    generateContent.mockRejectedValue(new Error('boom'))

    await identify()

    const logged = vi.mocked(console.warn).mock.calls.flat().join(' ')
    expect(logged).not.toContain('test-key')
    expect(logged).not.toContain(IMAGE.toString('base64'))
  })
})

describe('normalizeGeminiFood', () => {
  it('rejects text that is not JSON', () => {
    expect(normalizeGeminiFood('Banana!')).toBeNull()
    expect(normalizeGeminiFood(undefined)).toBeNull()
  })

  it('rejects JSON missing required fields', () => {
    expect(normalizeGeminiFood(JSON.stringify({ identified: true, name: 'Banana' }))).toBeNull()
  })

  it('treats an identification without a name as unsuccessful', () => {
    expect(normalizeGeminiFood(JSON.stringify({ ...BANANA, name: '  ' }))).toEqual({
      identified: false,
    })
  })

  it('drops quantities that are not whole positive numbers and trims strings', () => {
    const result = normalizeGeminiFood(
      JSON.stringify({ ...BANANA, name: ' Apple ', quantity: 1.5, unit: '', ripeness: null }),
    )

    expect(result).toEqual({
      identified: true,
      food: { name: 'Apple', brand: null, category: 'Fresh fruit', quantity: null, unit: null, ripeness: null },
    })
  })
})
