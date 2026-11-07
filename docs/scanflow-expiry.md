# Scan flow: expiry suggestions on real products

How the barcode flow gets a best-before suggestion, what was measured on real products, and the
risks that remain. The tests in `server/src/test/normalizedExpiry.test.ts` run these records.

## The flow

1. `ScanPage` recognizes a barcode and calls `GET /api/food/barcode/:barcode`.
2. The route reads the global `items` table, keyed by the barcode padded to GTIN-14. A saved product
   is returned as it is, with no product database call and no use of the per-user lookup limit.
   Otherwise, or when the table can't answer, it calls `lookupProduct` in
   `testscripts/normalizer.ts` (rate limited per user) and saves the FINAL record whole as JSONB.
   Either way the response is that record, unchanged, as `product`: `source` for one hit, `sources`
   for a merge. It adds `category`, our own label for the record.
3. `AddItemPage` receives the record through route state and prefills name, brand and barcode.
   The record's `quantity` ("400.0 g") is the package size. It is only shown as a hint, and the
   form's quantity stays a count of items.
4. `POST /api/food/expiry-suggestion` reuses the row's saved shelf life when the request still
   describes the saved product, and otherwise runs the category-first+semantic engine from
   `expiry-tests/`.
5. The user presses "Use <date>" or types a date. Nothing fills the date on its own, and changing
   the date bought clears a date that came from a suggestion. The page keeps the answer's shelf life
   in `sessionStorage`, per user, barcode and form values, and moves the suggested date itself when
   the date bought changes.
6. `POST /api/inventory` saves the item, with the owner taken from the session. The "Item Added"
   screen only shows the row the server returned.

### When Gemini is used

The fallback is on whenever `GEMINI_API_KEY` is set, in every environment, and it is billed to that
key. Without a key nothing is sent to Gemini, whatever the switches say.

| Variable | Unset or blank | To change it |
| --- | --- | --- |
| `EXPIRY_AI_FALLBACK_ENABLED` | On | `false`, `0`, `no` or `off` turns the whole fallback off. So does any value that isn't `1`, `true`, `yes` or `on` |
| `EXPIRY_AI_TIE_BREAK_ENABLED` | On | `false` turns off only the tie-break |
| `EXPIRY_AI_EXPANSION_ENABLED` | On | `false` turns off only the query expansion |

Each suggestion takes one of these paths, and makes at most one Gemini request:

| What happens first | Gemini request |
| --- | --- |
| The name or any category segment gets a high or medium local pick | None |
| Energy drink or soda (`isUnsupportedDrink`) | None. They skip the engine too |
| The name gets a low local pick that is still credible, with no close rival | None, and no date |
| The name's pick is tied with another credible row that has different dates | `tie_break`: Gemini picks one row from the shortlist, or none. Offered at `medium` |
| No credible local match for the name | `query_expansion`: Gemini gives 2 names and 2 categories, and the local engine searches them. Offered at `low` |

Gemini only ever chooses or finds a FoodKeeper row. The date always comes from that row, and the card
says AI helped. The nutrition drink check still applies to what Gemini finds. The request contains the
product's name, brand and category label, plus the database's own category text and English tags
when the record has them, and never the user, the barcode or the purchase date.

Requests count against a limit of 6 a minute and 60 a day per user, one at a time. A refused request,
a timeout (1.5 seconds) or an error means no date, and there is no retry. These limits are per
serverless instance. Only a `high` or `medium` match is saved to the shared row, so a product that
only gets a `low` answer costs another request each time it is asked about in a new session.

### Reusing a shelf life

A suggested response also carries `shelfLife`: the FoodKeeper row, its window, a `length` in whole days
or calendar months, where it came from (`source`, `confidence`, `aiUsed`), and no dates. It is true of
the product whenever it was bought, so it is safe to keep for later purchases. Adding `length` to a
purchase date with `setDate` or `setMonth` gives the same dates as the engine.

`suggestionFromShelfLife(input, stored)` turns a kept value back into a suggestion with no Gemini request:

| Result | Meaning |
| --- | --- |
| A suggestion with dates | Counted from this request's purchase date. Its `shelfLife` passed the checks |
| `status: 'none'` | The drink guards refused it, so offer no date |
| `null` | Malformed, or FoodKeeper no longer agrees. Treat it as not stored and call `suggestExpiry` |

The drink guards only run on the server, so a browser should only be given a `shelfLife` that came back
from one of these two functions, and should ask again when the name, brand or category changes.

The `items` row keeps this value in `expiry_suggestion`, never an absolute date. It is written only
for a fresh `high` or `medium` match on a request that matches the saved name, brand and categories,
so an edited form never reaches the shared row. A saved product is not looked up again, so a record
saved while a database was down, or with empty fields, stays as it is until the row is changed by hand.
A row with no shelf life, or one that can't be reused, is never an answer by itself: each request
for it runs the local engine again on the saved record, so a later engine can fill it in. The new
value is written only while the row still holds what the request read, so two requests can't
overwrite each other's answer. No-date answers are never stored, and no rows are rewritten in bulk.
The same goes for rows saved before the normalizer kept `categoryTags` or picked English names: they
keep their old name and have no tags, so they are searched the way they were before.

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

A second round of rules (below, "Names, tags and bounded rewrites") moved five of those twelve to a
date, judged by hand on the same records: Oreo, Prince and Nutella Biscuits to Cookies (crispy),
Kraft Singles to Cheese (processed slices), and Alesto's Amandes décortiquées to Almonds (no shell).
The other seven still offer no date. Nutella, milk and Coca-Cola are FoodKeeper's own "read the
package". Ketchup and ham are still `low` or tied, and muesli and Pringles have no row that fits.

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
- **Drinks FoodKeeper has no unopened date for get their own message.** It has no energy drink row,
  and its soda, soy beverage and carton orange juice rows only have an after-opening window. Canned
  Energy Drink reached Nutrition supplement drinks (#558) at high confidence, and Monster Energy Zero
  Ultra (`0070847015208`) reached Milk (ultra-pasteurized) on the word "Ultra". Energy drinks and soda
  now skip the engine and Gemini, and the nutrition drink rows need a nutrition word in the record.
  There is no fallback to the Beverages category, so supported drinks such as coconut water and
  bottled water still get their dates.

### Names, tags and bounded rewrites

- **English Open Food Facts tags are kept.** The normalizer stores the `en:` entries of
  `categories_tags` as `categoryTags`, in Open Food Facts' order. The route only uses them while the
  form still describes the saved record, and searches them after the name and the display category,
  narrowest (last) tag first, at most 8. They also feed the drink guards and the Gemini prompt.
- **English names are chosen conservatively.** `product_name_en` replaces `product_name` only when
  `lang` says the main name isn't English and the English one has no accent, no French, Spanish,
  Italian or German function word, and isn't just the brand. Otherwise the record keeps
  `product_name`.
- **Pack sizes come off names** (`cleanTitle`): "x22 - 304g", "16 oz, 24 ct", "(Pack of 2)". Only a
  trailing size or count after a separator is removed.
- **Accents are folded** in the FoodKeeper tokenizer and `appCategory`, so "décortiquées" is one word.
- **Bounded rewrites**, each true of the food itself: "shelled" and French "décortiqué" mean no shell,
  "amande" is almond, American cheese is process cheese (21 CFR 133.169), and a product the database
  calls a biscuit, with nothing saying dough, chilled, soft, mix or cracker, is searched as crispy
  cookies in the Bakery category. Plain "Almonds" is still a tie between in-shell and no-shell rows,
  and gets no date.

## Remaining risks

- **The drink guard is a word list.** An energy drink with an unlisted brand and no category text
  gets the general no-date message at best, or whatever the engine finds. A sparkling water filed
  under "Carbonated drinks" gets no date, even though FoodKeeper has a bottled water row.
- **Packaged juice can land on a fresh row.** "Carton Apple Juice" still matches Apple juice (fresh
  squeezed, 6 days), because FoodKeeper has no packaged apple juice row of its own.
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
- **Non-English records** match nothing unless a category segment or English tag is in English, or
  Open Food Facts has a believable `product_name_en`.
- **Tag order is assumed.** Open Food Facts usually lists tags from the top of its taxonomy down, but
  the code does not check the taxonomy, so "narrowest first" is the reverse of the list it sent.
- **The tag rules were built on hand-made records.** The tag tests use bodies written to Open Food
  Facts' shape, not live captures, so real tag lists may differ.
- **Merged records** take each field from the first source that has it, so a name from one database
  can sit next to a category from another.
- **Go-UPC was not measured.** Its category paths use the Google taxonomy, which `appCategory` handles
  in tests, but no live Go-UPC record has been through the engine.
- **Rate limits are per serverless instance**, like the existing identify limit, so they stop runaway
  use but are not an exact quota.
