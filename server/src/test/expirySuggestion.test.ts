import request from 'supertest'
import { app } from '../app.js'
import { EXPIRY_AI_PER_MINUTE, resetExpiryAiLimits } from '../food/rateLimit.js'

// Gemini is always mocked: tests never spend real API quota.
const generateContent = vi.hoisted(() => vi.fn())

vi.mock('@google/genai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@google/genai')>()),
  GoogleGenAI: class {
    models = { generateContent }
  },
}))

const YOGURT = {
  name: 'Greek Yogurt',
  brand: 'Dairyland',
  barcode: '012345678905',
  category: 'Dairy',
  productCategory: null,
  purchaseDate: '2026-11-07',
}
// Nothing in FoodKeeper shares a word with this, so no local match is credible.
const UNKNOWN = { ...YOGURT, name: 'Zzyzx', category: null }
// Real Open Food Facts record. Fruit cake and Commercial cakes are one point apart with different dates.
const TIED_CAKE = { ...YOGURT, name: 'Steam Cake', brand: 'T&T', barcode: '0776703289775', category: null }

const suggest = (body: unknown) => request(app).post('/api/food/expiry-suggestion').send(body as object)

describe('POST /api/food/expiry-suggestion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetExpiryAiLimits()
    vi.stubEnv('VITE_DISABLE_AUTH', 'true')
    vi.stubEnv('GEMINI_API_KEY', 'test-key')
    vi.stubEnv('EXPIRY_AI_FALLBACK_ENABLED', 'false')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('rejects requests without a token', async () => {
    vi.stubEnv('VITE_DISABLE_AUTH', '')

    expect((await suggest(YOGURT)).status).toBe(401)
  })

  it.each([
    ['a blank name', { ...YOGURT, name: '  ' }],
    ['a bad date', { ...YOGURT, purchaseDate: 'soon' }],
    ['an impossible date', { ...YOGURT, purchaseDate: '2026-02-31' }],
  ])('rejects %s', async (_label, body) => {
    expect((await suggest(body)).status).toBe(400)
  })

  it('suggests a date range from the local engine, counted from the date bought', async () => {
    const response = await suggest(YOGURT)

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      status: 'suggested',
      storage: 'fridge',
      matchedFood: 'Yogurt',
      confidence: 'high',
      aiUsed: false,
    })
    expect(response.body.earliest >= YOGURT.purchaseDate).toBe(true)
    expect(response.body.latest >= response.body.earliest).toBe(true)
    // The engine's debugging details stay on the server.
    expect(response.body).not.toHaveProperty('diagnostics')
    expect(response.body).not.toHaveProperty('candidates')
  })

  it('moves with the date bought', async () => {
    const first = await suggest(YOGURT)
    const later = await suggest({ ...YOGURT, purchaseDate: '2026-11-17' })

    expect(later.body.earliest > first.body.earliest).toBe(true)
  })

  it('offers no date when nothing credible matches', async () => {
    const response = await suggest(UNKNOWN)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ status: 'none', message: expect.stringMatching(/check the package/i) })
  })

  it('offers no date when FoodKeeper says to read the package', async () => {
    const response = await suggest({ ...YOGURT, name: 'Whole Milk' })

    expect(response.body.status).toBe('none')
  })

  it('does not trust a low-confidence pick', async () => {
    const response = await suggest({ ...YOGURT, name: 'Tomato Ketchup', brand: 'Heinz', category: 'Pantry' })

    expect(response.body.status).toBe('none')
  })

  it('falls back to the product category for a marketing name, and marks it uncertain', async () => {
    const response = await suggest({
      ...YOGURT,
      name: 'Cheerios',
      category: 'Pantry',
      productCategory: 'Breakfast cereals',
    })

    expect(response.body).toMatchObject({
      status: 'suggested',
      matchedFood: expect.stringMatching(/cereal/i),
      confidence: 'medium',
    })
  })

  it('never searches on a broad category', async () => {
    const response = await suggest({
      ...YOGURT,
      name: 'Nutella',
      category: 'Pantry',
      productCategory: 'Snacks, Sweet snacks, fr:Goûter',
    })

    expect(response.body.status).toBe('none')
  })

  it('never calls Gemini when switched off, even with a key', async () => {
    await suggest(YOGURT)
    await suggest(UNKNOWN)
    await suggest(TIED_CAKE)

    expect(generateContent).not.toHaveBeenCalled()
  })

  describe('with no API key', () => {
    it.each([undefined, 'true'])('stays local when the switch is %s', async (value) => {
      vi.stubEnv('GEMINI_API_KEY', '')
      vi.stubEnv('EXPIRY_AI_FALLBACK_ENABLED', value)

      expect((await suggest(YOGURT)).body).toMatchObject({ status: 'suggested', aiUsed: false })
      expect((await suggest(UNKNOWN)).body.status).toBe('none')
      expect((await suggest(TIED_CAKE)).body.status).toBe('none')
      expect(generateContent).not.toHaveBeenCalled()
    })
  })

  describe('with a key and no switches set', () => {
    beforeEach(() => {
      vi.stubEnv('EXPIRY_AI_FALLBACK_ENABLED', undefined)
      vi.stubEnv('EXPIRY_AI_TIE_BREAK_ENABLED', undefined)
      vi.stubEnv('EXPIRY_AI_EXPANSION_ENABLED', undefined)
      generateContent.mockResolvedValue({
        text: JSON.stringify({ alternativeNames: ['Yogurt', 'Plain yogurt'], alternativeCategories: ['Dairy', 'Fridge'] }),
      })
    })

    it('does not count an answer the local engine could give', async () => {
      for (let i = 0; i < EXPIRY_AI_PER_MINUTE + 1; i++) {
        expect((await suggest(YOGURT)).body.status).toBe('suggested')
      }

      expect(generateContent).not.toHaveBeenCalled()
    })

    it.each([
      ['Monster Energy Zero Ultra', 'Monster', 'Artificially sweetened beverages, Energy drinks'],
      ['Canned Energy Drink', null, 'Beverages'],
      ['Red Bull', 'Red Bull', null],
      ['Coca-Cola Original', 'Coca-Cola', 'Colas'],
      ['Canned Soda', null, 'Beverages'],
      ['Silk Soy Beverage', 'Silk', 'Soy milks, Beverages'],
      ['Carton Orange Juice', 'Tropicana', 'Fruit juices'],
      ['Canned Sports Drink', null, 'Beverages'],
    ])('does not ask Gemini about %s, a drink FoodKeeper has no unopened date for', async (name, brand, productCategory) => {
      const response = await suggest({ ...UNKNOWN, name, brand, category: 'Beverages', productCategory })

      expect(response.body).toEqual({
        status: 'none',
        message: 'FoodKeeper has no unopened date for this drink. Check the package.',
      })
      expect(generateContent).not.toHaveBeenCalled()
    })

    it('settles a tie by asking Gemini which row it is', async () => {
      generateContent.mockResolvedValue({ text: JSON.stringify({ selectedId: 197, reason: 'A packaged cake.' }) })

      const response = await suggest(TIED_CAKE)

      expect(generateContent).toHaveBeenCalledTimes(1)
      expect(response.body).toMatchObject({
        status: 'suggested',
        matchedFood: 'Commercial cakes and muffins',
        confidence: 'medium',
        aiUsed: true,
      })
    })

    it('searches again on the terms Gemini gives for a name with no match', async () => {
      const response = await suggest(UNKNOWN)

      expect(generateContent).toHaveBeenCalledTimes(1)
      expect(response.body).toMatchObject({ status: 'suggested', confidence: 'low', aiUsed: true })
    })

    it('sends only the product to Gemini, and no date comes from its answer', async () => {
      generateContent.mockResolvedValue({
        text: JSON.stringify({ selectedId: 197, reason: 'Best before 2099-01-01.' }),
      })

      const response = await suggest(TIED_CAKE)
      const [{ contents }] = generateContent.mock.calls[0]
      const prompt: string = contents[0].parts[0].text

      expect(prompt).toContain('Steam Cake')
      expect(prompt).not.toContain('test-user')
      expect(prompt).not.toContain(TIED_CAKE.purchaseDate)
      expect(response.body.earliest).not.toContain('2099')
    })

    it('makes no second request and offers no date when Gemini fails', async () => {
      generateContent.mockRejectedValue(new Error('quota exceeded'))

      const response = await suggest(UNKNOWN)

      expect(response.status).toBe(200)
      expect(response.body.status).toBe('none')
      expect(generateContent).toHaveBeenCalledTimes(1)
    })

    it('leaves a tie to the user with only the tie-break switched off', async () => {
      vi.stubEnv('EXPIRY_AI_TIE_BREAK_ENABLED', 'false')

      expect((await suggest(TIED_CAKE)).body.status).toBe('none')
      expect(generateContent).not.toHaveBeenCalled()

      await suggest(UNKNOWN)
      expect(generateContent).toHaveBeenCalledTimes(1)
    })

    it('leaves a name with no match to the user with only expansion switched off', async () => {
      vi.stubEnv('EXPIRY_AI_EXPANSION_ENABLED', 'false')

      expect((await suggest(UNKNOWN)).body.status).toBe('none')
      expect(generateContent).not.toHaveBeenCalled()
    })

    it('marks an AI-found match and stops calling Gemini at the per-user limit', async () => {
      const first = await suggest(UNKNOWN)
      expect(first.body).toMatchObject({ aiUsed: true })

      for (let i = 1; i < EXPIRY_AI_PER_MINUTE; i++) await suggest(UNKNOWN)
      expect(generateContent).toHaveBeenCalledTimes(EXPIRY_AI_PER_MINUTE)

      const limited = await suggest(UNKNOWN)

      expect(limited.status).toBe(200)
      expect(limited.body.status).toBe('none')
      expect(generateContent).toHaveBeenCalledTimes(EXPIRY_AI_PER_MINUTE)
    })
  })
})
