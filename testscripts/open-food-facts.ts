// Standalone lookup against Open Food Facts, API v3.
// Run it with: npx tsx testscripts/open-food-facts.ts
//
// This prints the raw JSON for one hardcoded barcode. It does not
// decide whether the product was found, and it does not reshape
// the body. normalizer.ts is what turns a hit into a flat record.
//
// The endpoint is:
//   GET https://world.openfoodfacts.org/api/v3/product/{barcode}
// No API key. They do ask for a User-Agent that names the app,
// because the public API is shared and they block anonymous clients.
//
// The full product document is enormous (photos, packaging, every
// language, the whole nutrition table in several units). The fields
// query param asks for only the bits a pantry item would use.
// Asking for a field does not guarantee it comes back; missing
// values are simply absent.
//
// HTTP 200 is not a hit. A miss is also 200, with result.id set to
// something other than "product_found" and no useful product object.
// A real hit looks like:
//   result.id === "product_found"
//   product.product_name, product.brands, product.quantity
//   product.categories          human-readable category string
//   product.categories_tags     machine tags such as "en:spreads"
//   product.countries           where the product page was contributed
//   product.image_front_url
//   product.ingredients_text
//   product.nutriments          per-100g numbers; left in the raw dump
// The normalizer reads the product fields above and ignores nutriments.
// A non-200 (network block, 404 on a bad path, 5xx) throws here.

// export {} makes this file an ES module so top-level await is legal.
// There is no import in this file, so the empty export is what flips
// it from a script into a module.
export { };

// Nutella, the 400g jar. Same sample as the other lookup scripts.
const barcode = "3017624010701";

// Comma-separated list, which is the v3 fields syntax. Each name is
// a key we want copied onto the product object in the response.
const fields = [
  "code",
  "product_name",
  "brands",
  "quantity",
  "categories",
  "categories_tags",
  "countries",
  "countries_tags",
  "image_front_url",
  "ingredients_text",
  "nutriments",
].join(",");

// The barcode is a path segment, not a query parameter. fields is
// the only query string. product_type is left off here; all-sources.ts
// adds product_type=all when it wants non-food barcodes too.
const url =
  `https://world.openfoodfacts.org/api/v3/product/${barcode}` +
  `?fields=${fields}`;

const response = await fetch(url, {
  headers: {
    // Identifies this playground. Open Food Facts expects a real
    // contact-style agent string on the public API.
    "User-Agent": "BestBefore/0.1 (development playground)",
  },
});

// ok covers 200-299. A missing product is still 200, so this only
// catches transport and server failures, not "barcode unknown".
if (!response.ok) {
  throw new Error(`Open Food Facts returned ${response.status}`);
}

// Typical hit: { code, product: {...}, result: { id: "product_found" }, status: "success" }.
const data = await response.json();

// depth: null so nutriments and the nested product object are not
// collapsed to [Object].
console.dir(data, { depth: null });
