import { ApiError, apiFetch } from '../lib/api'
import { fetchExpirySuggestion, fetchPhotoMatch, lookupBarcode } from '../lib/foodApi'

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  apiFetch: vi.fn(),
}))
vi.mock('../lib/authClient', () => ({ getApiToken: async () => 'test-token' }))

const FIELDS = {
  barcode: '012345678905',
  name: 'Whole Milk',
  brand: null,
  description: null,
  quantity: '400.0 g',
  category: 'Dairies, Milks',
  imageUrl: null,
  ingredients: null,
}

const signal = () => new AbortController().signal

describe('lookupBarcode', () => {
  afterEach(() => {
    vi.mocked(apiFetch).mockReset()
  })

  it('asks for the barcode with its leading zeros', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ product: { source: 'Open Facts', ...FIELDS }, category: 'Dairy' })

    await lookupBarcode('012345678905', signal())

    expect(vi.mocked(apiFetch).mock.lastCall![0]).toBe('/food/barcode/012345678905')
  })

  it.each([
    ['one source', { source: 'Open Facts', ...FIELDS }],
    ['merged sources', { sources: ['Open Facts', 'UPCitemdb'], ...FIELDS }],
  ])('keeps the record from %s whole', async (_label, product) => {
    vi.mocked(apiFetch).mockResolvedValue({ product, category: 'Dairy' })

    await expect(lookupBarcode('012345678905', signal())).resolves.toEqual({
      barcode: '012345678905',
      product,
      category: 'Dairy',
      notice: null,
    })
  })

  it('says when the product was added by someone from a photo', async () => {
    const product = { source: 'AI Vision', ...FIELDS, quantity: null, category: 'Dairy' }
    vi.mocked(apiFetch).mockResolvedValue({ product, category: 'Dairy' })

    const result = await lookupBarcode('012345678905', signal())

    expect(result).toMatchObject({ product, category: 'Dairy' })
    expect(result.notice).toMatch(/added this product from a photo/)
  })

  it.each([
    ['not found', new ApiError(404, 'No product found for this barcode.'), /No product found/],
    ['the limit', new ApiError(429, 'Product lookup limit reached.'), /limit reached/],
    ['a server failure', new ApiError(502), /couldn't look up/],
    ['a dropped connection', new TypeError('Failed to fetch'), /couldn't look up/],
  ])('falls back to manual entry on %s', async (_label, error, notice) => {
    vi.mocked(apiFetch).mockRejectedValue(error)

    const result = await lookupBarcode('012345678905', signal())

    expect(result).toMatchObject({ barcode: '012345678905', product: null, category: null })
    expect(result.notice).toMatch(notice)
  })

  it('treats an unexpected response as a failed lookup', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ product: { name: 'No other fields' }, category: null })

    await expect(lookupBarcode('012345678905', signal())).resolves.toMatchObject({ product: null })
  })

  it('rejects when the caller aborted', async () => {
    const abort = new AbortController()
    vi.mocked(apiFetch).mockImplementation(() => {
      abort.abort()
      return Promise.reject(new DOMException('Aborted', 'AbortError'))
    })

    await expect(lookupBarcode('012345678905', abort.signal)).rejects.toThrow('Aborted')
  })
})

describe('fetchExpirySuggestion', () => {
  const ITEM = {
    name: 'Milk',
    brand: null,
    barcode: null,
    category: 'Dairy',
    productCategory: null,
    purchaseDate: '2026-11-07',
  }

  it('rejects a response that is not a suggestion', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ status: 'suggested' })

    await expect(fetchExpirySuggestion(ITEM)).rejects.toThrow()
  })
})

describe('fetchPhotoMatch', () => {
  afterEach(() => {
    vi.mocked(apiFetch).mockReset()
  })

  it('sends only the token and returns the match', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ match: { name: 'Skyr', brand: null, category: 'Dairy' } })

    await expect(fetchPhotoMatch('signed.token')).resolves.toEqual({ name: 'Skyr', brand: null, category: 'Dairy' })
    const [path, options] = vi.mocked(apiFetch).mock.lastCall!
    expect(path).toBe('/food/photo/match')
    expect(JSON.parse(options!.body as string)).toEqual({ photoToken: 'signed.token' })
  })

  it.each([
    ['a failure', () => Promise.reject(new ApiError(400))],
    ['an unexpected answer', () => Promise.resolve({ match: { name: '' } })],
  ])('gives null on %s, since the form works without it', async (_label, answer) => {
    vi.mocked(apiFetch).mockImplementation(answer as never)

    await expect(fetchPhotoMatch('signed.token')).resolves.toBeNull()
  })
})
