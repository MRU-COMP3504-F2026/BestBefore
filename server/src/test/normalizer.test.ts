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
