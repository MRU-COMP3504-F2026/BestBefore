# Scan flow: expiry suggestions on real products

How the barcode flow gets a best-before suggestion, what was measured on real products, and the
risks that remain. The tests in `server/src/test/normalizedExpiry.test.ts` run these records.

## The flow

1. `ScanPage` recognizes a barcode and calls `GET /api/food/barcode/:barcode` (rate limited per user).
2. The route calls `lookupProduct` in `testscripts/normalizer.ts` and returns its FINAL record
   unchanged as `product`: `source` for one hit, `sources` for a merge. It adds `category`, our own
   label for the record.
3. `AddItemPage` receives the record through route state and prefills name, brand and barcode.
   The record's `quantity` ("400.0 g") is the package size. It is only shown as a hint, and the
   form's quantity stays a count of items.
4. `POST /api/food/expiry-suggestion` runs the category-first+semantic engine from `expiry-tests/`.
5. The user presses "Use <date>" or types a date. Nothing fills the date on its own, and changing
   the date bought clears a date that came from a suggestion.
6. `POST /api/inventory` saves the item, with the owner taken from the session. The "Item Added"
   screen only shows the row the server returned.

The Gemini fallback is off unless `EXPIRY_AI_FALLBACK_ENABLED=true`. When it is on, Gemini is only
asked after every local search fails, at most once per suggestion, and each request counts against
a per-user limit.

## What was measured

22 barcodes were looked up live on 2026-11-07, with Open Food Facts and UPCitemdb only (no Go-UPC
key in that run). 19 returned a record, kept in `expiry-tests/fixtures/normalized-products.json`.
The expected answers were judged by hand. This is a small sample, chosen from common products, so it
shows how the engine fails but is not an accuracy figure.

The engine scored 92% on `expiry-tests/fixtures/seed-items.json`. That number does not transfer,
because the fixtures have clean food names and our own category labels. Real records have neither.

Before the changes below, running each record's name through the engine directly:

| Product name in the record | Engine's pick | Problem |
| --- | --- | --- |
| Tomato Ketchup | Tomato paste, 27 months | Wrong food, confidence `low` |
| Dark Red Kidney Beans | Mung bean sprouts, fridge | Wrong food, confidence `tie` |
| Smoked Ham | Fresh ham, 7 days | Wrong form, confidence `tie` |
| Cheerios, Prince, isabelle, Skyr, Tiny Twists Original | none | Name shares no word with FoodKeeper |
| American (Kraft Singles) | none | The cheese is in the brand and category, not the name |
| Amandes décortiquées | none | FoodKeeper is English only |
| oreo cookies shelf | Cookies (soft), route `no_match` | Contributor noise as the head word |

After the changes, on the same 19 records:

| Result | Count | Products |
| --- | --- | --- |
| Correct date offered | 7 | Cheerios, Barilla spaghetti, Cristaline water, Rold Gold pretzels, Progresso soup, Great Value beans, Danone skyr |
| Wrong date offered | 0 | |
| No date, user types it | 12 | Includes milk and Coca-Cola, where FoodKeeper itself says to read the package |

Offering no date is the intended failure. The user sees why and types the printed date.

## What changed because of it

- **Only high or medium local picks are offered.** `low` and `tie` picks were the wrong ones above,
  and the engine's own `no_match` guesses are never shown either.
- **The product's category text is a second search.** When the name fails, each specific segment
  ("Breakfast cereals", "Pretzel") is searched in turn. A date found this way is capped at `medium`
  and the card says it is uncertain.
- **Broad segments are skipped.** "Snacks" matched Nutella to gummy fruit snacks.
- **Free-text categories are mapped to our labels** by `appCategory`, because `CATEGORY_HINTS` only
  matches exact labels such as `Dairy`. Without the mapping, category-first quietly becomes
  index-first on every scanned product.

## Remaining risks

- **Category text is contributor data.** Open Food Facts segments are not reliably ordered from broad
  to specific ("Cheeses, Yogurts, Plain skyrs"), so `appCategory` and the search order can pick the
  less fitting segment. Skyr is only right because "Cheeses" ties and is skipped.
- **Category words are not the food.** A list of rules can misfile a product. "Chocolate biscuits"
  and "Spring waters" work; new phrasing may not. `BROAD_SEGMENTS` and `CATEGORY_RULES` were tuned on
  these 19 records, so they may be overfitted to them.
- **Coarse rows.** "Canned goods" is correct for canned soup and beans, but its range is years wide.
  The offered date is the early end of the range, and the card shows the whole range.
- **Brand mismatches.** Brands only tell the engine an item is packaged. Brand-as-name records
  ("Nutella" with brand "Nutella, Ferrero") rely entirely on category text, and a brand in the name
  can match an unrelated FoodKeeper word.
- **Non-English records** match nothing unless a category segment is in English.
- **Merged records** take each field from the first source that has it, so a name from one database
  can sit next to a category from another.
- **Go-UPC was not measured.** Its category paths use the Google taxonomy, which `appCategory` handles
  in tests, but no live Go-UPC record has been through the engine.
- **Rate limits are per serverless instance**, like the existing identify limit, so they stop runaway
  use but are not an exact quota.
