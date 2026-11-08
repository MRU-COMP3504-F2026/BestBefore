import request from 'supertest'
import { app } from '../app.js'
import { findItem } from '../food/items.js'
import { lookupProduct } from '../../../testscripts/normalizer.js'

// AI Vision's suggestions come from FoodKeeper alone. Nothing here may reach a product database,
// the items table or Gemini, so all three are mocked and checked.
vi.mock('../food/items.js', () => ({
  describesRecord: vi.fn(),
  findItem: vi.fn(),
  isShareable: vi.fn(),
  rememberItem: vi.fn(),
  rememberShelfLife: vi.fn(),
}))

vi.mock('../../../testscripts/normalizer.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../testscripts/normalizer.js')>()),
  lookupProduct: vi.fn(),
}))

const generateContent = vi.hoisted(() => vi.fn())

vi.mock('@google/genai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@google/genai')>()),
  GoogleGenAI: class {
    models = { generateContent }
  },
}))

// What the add form sends for a photo Gemini called an apple.
const APPLE = {
  name: 'Apple',
  brand: null,
  barcode: null,
  category: null,
  productCategory: 'Fresh fruit',
  purchaseDate: '2026-11-07',
  source: 'photo',
}

const suggest = (body: object) => request(app).post('/api/food/expiry-suggestion').send(body)

describe('POST /api/food/expiry-suggestion for an AI Vision photo', () => {
  const fetchSpy = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('VITE_DISABLE_AUTH', 'true')
    // The fallback is switched on, so only the photo path can be keeping Gemini out.
    vi.stubEnv('GEMINI_API_KEY', 'test-key')
    vi.stubEnv('EXPIRY_AI_FALLBACK_ENABLED', 'true')
    generateContent.mockResolvedValue({ text: '{}' })
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('suggests a FoodKeeper date for a recognized apple', async () => {
    const response = await suggest(APPLE)

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ status: 'suggested', aiUsed: false })
    expect(response.body.matchedFood).toMatch(/apple/i)
    expect(response.body.shelfLife).toMatchObject({ aiUsed: false })
    expect(response.body.earliest >= APPLE.purchaseDate).toBe(true)
    expect(generateContent).not.toHaveBeenCalled()
  })

  it('gives no date, without asking Gemini, when FoodKeeper has no match', async () => {
    const response = await suggest({ ...APPLE, name: 'Zzyzx', productCategory: null })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ status: 'none', message: expect.stringMatching(/package/i) })
    expect(generateContent).not.toHaveBeenCalled()
  })

  it('never looks a barcode up, even when the form has one', async () => {
    const response = await suggest({ ...APPLE, barcode: '012345678905' })

    expect(response.status).toBe(200)
    expect(findItem).not.toHaveBeenCalled()
    expect(lookupProduct).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(generateContent).not.toHaveBeenCalled()
  })

  it('never makes up a date for soy milk', async () => {
    const response = await suggest({ ...APPLE, name: 'Soy milk', productCategory: 'Plant-based milk' })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ status: 'none', message: expect.stringMatching(/package/i) })
    expect(generateContent).not.toHaveBeenCalled()
  })

  it('uses the category chosen on the form over the photo one', async () => {
    const response = await suggest({ ...APPLE, name: 'Greek Yogurt', category: 'Dairy', productCategory: 'Fresh fruit' })

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ status: 'suggested', matchedFood: 'Yogurt', storage: 'fridge', aiUsed: false })
    expect(generateContent).not.toHaveBeenCalled()
  })

  it('rejects an unknown source', async () => {
    expect((await suggest({ ...APPLE, source: 'gemini' })).status).toBe(400)
  })
})
