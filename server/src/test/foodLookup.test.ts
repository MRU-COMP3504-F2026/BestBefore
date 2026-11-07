import request from 'supertest'
import { lookupProduct } from '../../../testscripts/normalizer.js'
import { app } from '../app.js'
import { LOOKUP_PER_MINUTE, resetLookupLimits } from '../food/rateLimit.js'

// The product databases are always faked: tests never spend their quotas.
const fetchMock = vi.fn()

type Answers = { openFacts?: unknown; upcItemDb?: unknown; goUpc?: unknown }

const OPEN_FACTS_HIT = {
  code: '012345678905',
  result: { id: 'product_found' },
  product: {
    code: '012345678905',
    product_name: 'Whole Milk',
    brands: 'Dairyland',
    quantity: '400.0 g',
    categories: 'Dairies, Milks',
    image_front_url: 'https://images.test/milk.jpg',
    ingredients_text: 'Milk',
  },
}
const OPEN_FACTS_MISS = { result: { id: 'product_not_found' } }
const UPC_HIT = {
  total: 1,
  items: [{ ean: '0012345678905', title: 'Reseller Milk Title', brand: 'Other', description: 'Fresh milk', images: [] }],
}
const UPC_MISS = { total: 0, items: [] }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

// Answers each database by its URL. An Error rejects, as a dropped connection would.
function answer({ openFacts = OPEN_FACTS_MISS, upcItemDb = UPC_MISS, goUpc = json({}, 404) }: Answers) {
  fetchMock.mockImplementation(async (url: string) => {
    const value = url.includes('openfoodfacts') ? openFacts : url.includes('upcitemdb') ? upcItemDb : goUpc
    if (value instanceof Error) throw value
    return value instanceof Response ? value : json(value)
  })
}

const lookup = (barcode = '012345678905') => request(app).get(`/api/food/barcode/${barcode}`)

describe('GET /api/food/barcode/:barcode', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    resetLookupLimits()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('VITE_DISABLE_AUTH', 'true')
    vi.stubEnv('GO_UPC_API_KEY', '')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('rejects requests without a token', async () => {
    vi.stubEnv('VITE_DISABLE_AUTH', '')

    const response = await lookup()

    expect(response.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['abc', '1234567', '123456789012345', '12345678a'])('rejects %s without using quota', async (code) => {
    const response = await lookup(code)

    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns one hit as the exact normalized record, with `source`', async () => {
    answer({ openFacts: OPEN_FACTS_HIT })

    const response = await lookup()

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      category: 'Dairy',
      product: {
        source: 'Open Facts',
        barcode: '012345678905',
        name: 'Whole Milk',
        brand: 'Dairyland',
        description: null,
        quantity: '400.0 g',
        category: 'Dairies, Milks',
        imageUrl: 'https://images.test/milk.jpg',
        ingredients: 'Milk',
      },
    })
  })

  it('returns several hits as the exact merged record, with `sources` and the scanned barcode', async () => {
    answer({ openFacts: OPEN_FACTS_HIT, upcItemDb: UPC_HIT })

    const response = await lookup()

    expect(response.status).toBe(200)
    expect(response.body.product).toEqual({
      barcode: '012345678905',
      sources: ['Open Facts', 'UPCitemdb'],
      name: 'Whole Milk',
      brand: 'Dairyland',
      description: 'Fresh milk',
      quantity: '400.0 g',
      category: 'Dairies, Milks',
      imageUrl: 'https://images.test/milk.jpg',
      ingredients: 'Milk',
    })
  })

  it('says not found only when every database answered', async () => {
    answer({})

    const response = await lookup()

    expect(response.status).toBe(404)
    expect(response.body).toEqual({ error: 'No product found for this barcode.' })
    // Go-UPC has no key here, so it is skipped rather than called with a bad one.
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not call a miss "not found" when a database failed', async () => {
    answer({ upcItemDb: json({}, 429) })

    const response = await lookup()

    expect(response.status).toBe(502)
    expect(response.body).toEqual({ error: "Couldn't reach the product databases." })
  })

  it('still returns a product when only one database failed', async () => {
    answer({ openFacts: OPEN_FACTS_HIT, upcItemDb: new Error('connection reset') })

    const response = await lookup()

    expect(response.status).toBe(200)
    expect(response.body.product.source).toBe('Open Facts')
  })

  it('treats an unreadable 200 as a failure, not a miss', async () => {
    answer({ openFacts: new Response('<html>', { status: 200 }) })

    expect((await lookup()).status).toBe(502)
  })

  it('limits lookups per minute, per user', async () => {
    answer({ openFacts: OPEN_FACTS_HIT })
    for (let i = 0; i < LOOKUP_PER_MINUTE; i++) {
      expect((await lookup()).status).toBe(200)
    }
    fetchMock.mockClear()

    const response = await lookup()

    expect(response.status).toBe(429)
    expect(response.body.error).toMatch(/limit reached/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a second lookup while one is running', async () => {
    let finish!: (value: Response) => void
    fetchMock.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const first = lookup().then((response) => response)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())

    const second = await lookup()

    expect(second.status).toBe(429)
    expect(second.body).toEqual({ error: 'Already looking up a product.' })
    finish(json(UPC_MISS))
    await first
  })
})

describe('lookupProduct', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('gives up on a source that hangs and reports the timeout', async () => {
    vi.stubEnv('GO_UPC_API_KEY', '')
    vi.stubGlobal(
      'fetch',
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(init.signal!.reason))
        }),
    )

    const { results, final } = await lookupProduct('012345678905', 20)

    expect(final).toBeNull()
    expect(results.find((result) => result.source === 'Open Facts')?.error).toBe('timed out after 20 ms')
    expect(results.find((result) => result.source === 'Go-UPC')?.skipped).toBe(true)
  })

  it('reads the Go-UPC key when called, not when imported', async () => {
    vi.stubEnv('GO_UPC_API_KEY', 'late-key')
    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => json({}, 404))
    vi.stubGlobal('fetch', fetchMock)

    await lookupProduct('012345678905')

    const goUpc = fetchMock.mock.calls.find(([url]) => url.includes('go-upc'))
    expect(goUpc?.[1].headers.Authorization).toBe('Bearer late-key')
  })
})
