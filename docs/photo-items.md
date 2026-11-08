# AI Vision photos: prefill and shared items

## Prefill

`POST /api/food/identify` returns what Gemini saw. The add form fills in:

- **Name**, always, with a "From your photo" hint.
- **Brand**, only if Gemini read it off the package. It is told to return null rather than guess.
- **Category**, only when Gemini's text is one of our labels. Anything else stays on "Not sure".
- **Quantity**, only when Gemini counted items ("3 piece"). It is never filled from a weight or
  volume ("500 g", "2 L"), and stays at 1 otherwise.

Barcode and best before are never filled from a photo. The date still comes only from the
user accepting the FoodKeeper suggestion or typing one in. Every field stays editable.

## Sharing to the `items` table

Nothing is written when a photo is identified, a suggestion or match is shown, the form is
cancelled, or a save fails validation. The only write happens on `POST /api/inventory`, and only
when all of these are true:

1. The body has `photoToken`, the `provenance` the identify response gave. It is an HMAC over
   `{ user id, alias, expiry }` (1 hour), keyed from `GEMINI_API_KEY`. The alias is the folded name
   and brand Gemini gave the photo, so the client can't make it up. The token is never stored.
2. The token checks out for the signed-in user.
3. Any barcode typed is a GTIN with a valid check digit. A wrong one shares nothing (`bad-barcode`).
4. The name and brand look like product text: 60 characters or fewer, with no email, link or
   phone-like run of digits (`private-text` otherwise).
5. The user's own inventory row was saved first. The neon-http driver has no interactive
   transactions, so the two writes run in order. A failed share never fails the save: the 201
   carries `catalog: 'saved' | 'exists' | 'unverified' | 'bad-barcode' | 'private-text' | 'failed'`.

Each row has exactly one key (a check constraint enforces it):

- **With a barcode:** `barcode`, the GTIN-14, as for database lookups.
- **Without one:** `photo_key = v1|<name>|<brand>|<category>`. Name and brand are folded (case,
  accents, punctuation, spacing), and the category is one of our labels or empty. There is no
  stemming or synonym matching, so "Apple" and "Apples", or the same food in Dairy and Frozen, stay
  separate rows instead of being merged into one product.

`photo_alias` stores the token's alias on both kinds of row. The payload has `source: 'AI Vision'`
plus the name, brand and category as saved. No owner, dates, count, photo or token goes in it.
Writes are insert-only (`ON CONFLICT DO NOTHING` on whichever key applies), so a repeat save, or a
code a database already found, keeps the row it already has.

## Reading it back

- **Barcode scan:** `GET /api/food/barcode/:code` treats a barcode `AI Vision` row as a fallback.
  It still asks the product databases first. A record they return replaces the photo row (its shelf
  life is cleared), and the photo row is only returned when they miss or can't be reached. The
  client then shows "Someone added this product from a photo". A row with no barcode is never
  returned by a barcode scan.
- **Later photo:** the add form sends its token to `POST /api/food/photo/match`. The server looks
  up barcode-less rows with that token's alias. It only offers one when exactly one product was
  confirmed for the alias; two different answers return nothing. The form shows "Someone saved a
  photo like this as …" with a **Use These Details** button. It never applies the match without
  that click, and never touches the date. The lookup is read-only and is keyed only by the signed
  alias, so it can't be used to search the table.

## Migration

`drizzle/0004_photo_items_without_barcode.sql`:

1. Adds a unique constraint on `barcode` before dropping the old primary key.
2. Drops `items_pkey` and makes `barcode` nullable.
3. Adds `id serial` as the new primary key, plus `photo_key` (unique), `photo_alias` (indexed),
   and the one-key check.

Existing rows keep their barcode, payload and shelf life, and existing `ON CONFLICT ("barcode")`
writes behave as before.

Before running it anywhere real, confirm the primary key is named `items_pkey`. The query is in
the migration's header. If the name differs, the migration fails at that statement.

## Known limits

- A typed barcode can't be checked against a database on the photo path. A wrong but valid code
  shares the product under that code until a database answers for it.
- The text check only catches obvious contact details. A short personal note can still pass.
- Barcode-less matches go through Gemini's naming. If Gemini names a different food the same way,
  the offer can be wrong, which is why it is only shown when unambiguous and only applied on a
  click.
- A token can be reused, within its hour, by the user it was issued to. Each reuse can only add
  rows for keys that don't exist yet.
- Barcode-less rows have no shelf life saved yet. The photo path's suggestion is always FoodKeeper,
  worked out fresh.
