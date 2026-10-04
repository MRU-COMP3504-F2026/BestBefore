// Standalone lookup against Go-UPC.
// Run it with: npx tsx testscripts/go-upc.ts
//
// This prints the HTTP status and then the raw JSON. It does not
// reshape the product. normalizer.ts is what flattens a hit.
//
// The endpoint is:
//   GET https://go-upc.com/api/v1/code/{barcode}
// Auth is an API key in .env.local, variable GO_UPC_API_KEY, sent
// as Authorization: Bearer <key>. There is no key in the repo.
// dotenv loads .env.local from the current working directory, so
// run this from the project root.
//
// Unlike the other two sources, a miss here is HTTP 404 with a JSON
// body, not an empty 200. That is why the status is printed before
// the body: a 404 is still useful to read.
//
// A hit is 200 and looks like:
//   code            the barcode string we sent
//   codeType        "EAN" or "UPC"
//   product.name
//   product.brand
//   product.description
//   product.imageUrl
//   product.category           the leaf category, such as "Dips & Spreads"
//   product.categoryPath       the full path as an array of strings
//   product.ingredients.text   ingredient list, nested one level down
//   product.netContent.text    pack size, such as "1000.0 g"
//   product.specs              array of [label, value] pairs for other
//                              attributes. Sometimes a weight lives here
//                              when netContent is missing. "Packsize detail"
//                              is usually a serving note, not the jar size.
//   product.formattedEAN       barcode as a string, leading zeros kept
//   product.ean, product.upc   often numbers, which can drop a leading zero
//   inferred                   true when Go-UPC guessed a missing check digit
// 401 means the key was missing or wrong. 429 means the plan quota
// or the 2-requests-per-second cap was hit.

import { config } from "dotenv";

// Reads GO_UPC_API_KEY into process.env. Does not override variables
// that are already set in the shell. Silent if the file is missing,
// in which case the header below sends "Bearer undefined".
config({ path: ".env.local" });

const GO_UPC_API_KEY = process.env.GO_UPC_API_KEY;

// Nutella, the 400g jar. Same sample as the other lookup scripts.
const barcode = "3017624010701";

const response = await fetch(
  // The code is a path segment. Go-UPC also accepts ?key= as a
  // query parameter; the Bearer header is the one their docs prefer.
  `https://go-upc.com/api/v1/code/${barcode}`,
  {
    headers: {
      Authorization: `Bearer ${GO_UPC_API_KEY}`,
      Accept: "application/json",
    },
  }
);

// Printed even when the call failed, because 404 and 401 still have
// a JSON body worth looking at. This script does not throw on them.
console.log(`HTTP ${response.status}`);

const data = await response.json();

// colors: true is only for the terminal. depth: null prints nested
// product, specs, and ingredients instead of stopping early.
console.dir(data, {
  depth: null,
  colors: true,
});
