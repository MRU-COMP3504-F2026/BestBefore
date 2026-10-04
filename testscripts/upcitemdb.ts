// Standalone lookup against the UPCitemdb trial API.
// Run it with: npx tsx testscripts/upcitemdb.ts
//
// This file does not normalize anything. It fetches one hardcoded
// barcode and prints the raw JSON, so we can see the shape that
// normalizer.ts later has to read.
//
// There is no API key. The trial host is api.upcitemdb.com and the
// path is /prod/trial/lookup. The query parameter is named upc even
// when the code is really an EAN-13.
//
// HTTP 200 does not mean a product was found. An unknown barcode
// still comes back 200 with { code: "OK", total: 0, items: [] }.
// A real hit has total > 0 and at least one object in items.
// The useful record is items[0]:
//   ean, upc       the code they stored
//   title          product name, often a long marketplace title
//   brand
//   description    frequently an empty string, which is not a description
//   category       a path joined with " > "
//   images         array of image URLs, often empty
//   weight, size   pack size when they have it, often ""
//   offers         retailer listings; we do not use these
// A rate limit or other real failure is a non-200. This script throws
// on those instead of printing the body.

// export {} makes this file an ES module. Top-level await is only
// legal in a module, and this file has no import of its own.
export { };

// Nutella, the 400g jar. The same sample the other lookup scripts
// use, so the raw dumps can be compared side by side.
const barcode = "3017624010701";

// encodeURIComponent is redundant for an all-digit code. It keeps
// the query string safe if this constant is ever edited.
const url =
  `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(barcode)}`;

// Accept asks for JSON. Without it some gateways answer with HTML.
const response = await fetch(url, {
  headers: {
    Accept: "application/json",
  },
});

// response.ok is true for status 200-299. A product miss is still
// 200, so passing this check does not mean the barcode was found.
// Non-200 here is a real failure: rate limit, bad request, outage.
if (!response.ok) {
  throw new Error(
    `UPCitemdb returned ${response.status}: ${response.statusText}`
  );
}

// The body is JSON: { code, total, offset, items: [...] }.
const data = await response.json();

// depth: null prints the whole tree. The default stops after a
// couple of levels and would hide the fields inside items[0].
console.dir(data, { depth: null });
