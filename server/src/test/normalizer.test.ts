import { foldText, tokenize } from '../../../expiry-tests/foodkeeper.js'
import { aggregate, cleanTitle, normalize, type NormalizedProduct } from '../../../testscripts/normalizer.js'

// Hand-built Open Food Facts bodies in the v3 shape, not live captures: no request is made here.
function openFacts(product: Record<string, unknown>): NormalizedProduct {
  return normalize('Open Facts', { result: { id: 'product_found' }, product }, '3017620422003')!
}

describe('Open Food Facts names', () => {
  it('uses the English name for a product whose main language is not English', () => {
    const record = openFacts({ lang: 'fr', product_name: 'Amandes décortiquées', product_name_en: 'Shelled almonds' })

    expect(record.name).toBe('Shelled almonds')
  })

  it.each([
    ['the French name copied over', 'Biscuits Noisettes et Cacao'],
    ['an accent', 'Amandes décortiquées'],
    ['only the brand', 'Nutella'],
  ])('keeps product_name when the English name is %s', (_case, english) => {
    const record = openFacts({
      lang: 'fr',
      product_name: 'Biscuits NUTELLA Biscuits Noisettes et Cacao',
      product_name_en: english,
      brands: 'Nutella, Ferrero',
    })

    expect(record.name).toBe('Biscuits NUTELLA Biscuits Noisettes et Cacao')
  })

  it('keeps an English product_name whatever product_name_en says', () => {
    expect(openFacts({ lang: 'en', product_name: 'Smoked Ham', product_name_en: 'Ham' }).name).toBe('Smoked Ham')
    // No lang: only a plainly foreign main name is swapped.
    expect(openFacts({ product_name: 'Smoked Ham', product_name_en: 'Ham' }).name).toBe('Smoked Ham')
    expect(openFacts({ product_name: 'Amandes décortiquées', product_name_en: 'Shelled almonds' }).name).toBe(
      'Shelled almonds',
    )
  })

  it('falls back to the English name when there is no other', () => {
    expect(openFacts({ lang: 'fr', product_name_en: 'Shelled almonds' }).name).toBe('Shelled almonds')
  })

  it('cuts the pack size off the name', () => {
    expect(openFacts({ product_name: 'Biscuits NUTELLA Biscuits Noisettes et Cacao x22 - 304g' }).name).toBe(
      'Biscuits NUTELLA Biscuits Noisettes et Cacao',
    )
  })
})

describe('Open Food Facts category tags', () => {
  it("keeps the English tags in Open Facts' order and drops the rest", () => {
    const record = openFacts({
      categories: 'Snacks, Biscuits, fr:Goûter',
      categories_tags: ['en:snacks', 'en:sweet-snacks', 'en:biscuits', 'fr:gouter', 'en:chocolate-biscuits', 7, ''],
    })

    expect(record.category).toBe('Snacks, Biscuits, fr:Goûter')
    expect(record.categoryTags).toEqual(['en:snacks', 'en:sweet-snacks', 'en:biscuits', 'en:chocolate-biscuits'])
  })

  it.each([[[]], [['fr:gouter']], [undefined], ['en:snacks']])('stores %j as null', (tags) => {
    expect(openFacts({ categories_tags: tags }).categoryTags).toBeNull()
  })

  it('carries the Open Facts tags onto a merged record', () => {
    const upc = normalize('UPCitemdb', { total: 1, items: [{ title: 'Prince Chocolate Biscuits, 10.5 oz' }] }, '1')!
    const merged = aggregate([openFacts({ categories_tags: ['en:biscuits'] }), upc], '1')

    expect(upc.categoryTags).toBeNull()
    expect(merged.categoryTags).toEqual(['en:biscuits'])
    expect(aggregate([upc, upc], '1').categoryTags).toBeNull()
  })
})

// Hand-built bodies in the shape of two cached records Brian reported, not live captures.
describe('merging sources that disagree', () => {
  const upcItemDb = (item: Record<string, unknown>) => normalize('UPCitemdb', { total: 1, items: [item] }, '1')!
  const goUpc = (product: Record<string, unknown>) => normalize('Go-UPC', { product }, '1')!

  it("leaves out a reseller listing for another product (Becel's swimsuit)", () => {
    const margarine = openFacts({
      product_name: 'Margarine',
      brands: 'Becel',
      categories: 'Spreads, Margarines',
      categories_tags: ['en:spreads', 'en:fats', 'en:margarines'],
    })
    const swimsuit = upcItemDb({
      title: "Women's One Piece Swimsuit Tummy Control Bathing Suit",
      brand: 'Unbranded',
      description: 'Swimwear for women, quick dry fabric.',
      category: 'Apparel & Accessories > Clothing > Swimwear',
      images: ['https://example.com/swimsuit.jpg'],
    })

    const merged = aggregate([margarine, swimsuit], '1')

    expect(merged).toMatchObject({
      name: 'Margarine',
      brand: 'Becel',
      category: 'Spreads, Margarines',
      description: null,
      imageUrl: null,
      sources: ['Open Facts'],
    })
  })

  it('drops a non-food category but keeps the rest of a matching listing (Unico olives)', () => {
    const olives = openFacts({ product_name: 'Kalamata Olives', brands: 'Unico' })
    const listing = upcItemDb({
      title: 'Unico Kalamata Olives, 375 ml',
      brand: 'Unico',
      description: 'Whole Kalamata olives in brine.',
      category: 'Luggage & Bags',
      images: ['https://example.com/olives.jpg'],
    })

    const merged = aggregate([olives, listing], '1')

    expect(merged).toMatchObject({
      category: null,
      description: 'Whole Kalamata olives in brine.',
      imageUrl: 'https://example.com/olives.jpg',
      sources: ['Open Facts', 'UPCitemdb'],
    })
  })

  it('takes the next food category when the first is not food', () => {
    const olives = openFacts({ product_name: 'Kalamata Olives', brands: 'Unico' })
    const merged = aggregate(
      [
        olives,
        goUpc({ name: 'Unico Kalamata Olives', categoryPath: ['Luggage & Bags', 'Suitcases'] }),
        upcItemDb({ title: 'Unico Kalamata Olives', category: 'Food, Beverages & Tobacco > Food Items > Olives' }),
      ],
      '1',
    )

    expect(merged.category).toBe('Food, Beverages & Tobacco > Food Items > Olives')
  })

  it.each<[string, Record<string, unknown>, Record<string, unknown>]>([
    // A French name meets an English title through the English tags.
    [
      'by its tags',
      { lang: 'fr', product_name: 'Amandes décortiquées', categories_tags: ['en:nuts', 'en:almonds'] },
      { title: 'Whole Natural Almonds', description: 'Raw almonds.' },
    ],
    ['by its brand', { product_name: 'Original', brands: 'Becel' }, { title: 'Becel Spread', description: 'Spread.' }],
    // Nothing to compare it against.
    ['with no title or brand', { product_name: 'Margarine' }, { description: 'Spread.' }],
  ])('keeps a listing that matches %s', (_case, product, item) => {
    const merged = aggregate([openFacts(product), upcItemDb(item)], '1')

    expect(merged.sources).toEqual(['Open Facts', 'UPCitemdb'])
    expect(merged.description).not.toBeNull()
  })

  it('keeps every listing when Open Facts has no name to check against', () => {
    const merged = aggregate(
      [goUpc({ name: 'Margarine', description: 'Spread.' }), upcItemDb({ title: 'Swimsuit', description: 'Swimwear.' })],
      '1',
    )

    expect(merged).toMatchObject({ name: 'Margarine', description: 'Spread.', sources: ['Go-UPC', 'UPCitemdb'] })
  })
})

describe('cleanTitle', () => {
  it.each([
    ['Oreo Chocolate Sandwich Cookies, Family Size, 19.1 oz (Pack of 2)', 'Oreo Chocolate Sandwich Cookies, Family Size'],
    ['Kraft Singles American Cheese Slices, 16 oz, 24 ct', 'Kraft Singles American Cheese Slices'],
    ['Coca-Cola 12 x 355 ml', 'Coca-Cola'],
    ['Partly Skimmed Milk 4 L', 'Partly Skimmed Milk'],
    // Nothing that isn't a trailing size or count.
    ['Spaghetti Nº5', 'Spaghetti Nº5'],
    ['V8 Original', 'V8 Original'],
    ['Nutella750g', 'Nutella750g'],
    ['7 Up', '7 Up'],
    // A name that is only a size stays as it came.
    ['500 g', '500 g'],
    [null, null],
  ])('%s -> %s', (title, clean) => {
    expect(cleanTitle(title)).toBe(clean)
  })

  it('cleans UPCitemdb titles too', () => {
    const record = normalize('UPCitemdb', { total: 1, items: [{ title: 'Smoked Ham - 9 oz' }] }, '1')!

    expect(record.name).toBe('Smoked Ham')
  })
})

describe('accents in FoodKeeper search words', () => {
  it.each([
    ['Amandes décortiquées', ['amande', 'decortiquee']],
    ['Crème brûlée', ['creme', 'brulee']],
    ['Œufs frais', ['oeuf', 'frai']],
    // NFD leaves º alone, so "Nº5" doesn't become the word "no".
    ['Spaghetti Nº5', ['spaghetti', 'n']],
  ])('%s', (text, tokens) => {
    expect(tokenize(text)).toEqual(tokens)
  })

  it('folds without changing plain text', () => {
    expect(foldText('Pâtes à tartiner')).toBe('Pates a tartiner')
    expect(foldText('Cheerios')).toBe('Cheerios')
  })
})
