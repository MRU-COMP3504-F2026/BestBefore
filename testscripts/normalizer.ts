// Lookup plus a first pass at one shared product shape.
// Run it with:
//   npx tsx testscripts/normalizer.ts 3017624010701
// or with no argument, and it prompts for a barcode.
//
// It asks the same three databases as the other scripts in this
// folder, then prints three sections:
//   ORIGINALS    the raw JSON from each source, hit or miss
//   NORMALIZED   one flat record per source that actually had a product
//   FINAL        one record to keep
//
// A source counts as found only on HTTP 200 with a product in the
// body. Those checks match all-sources.ts. Open Food Facts and
// UPCitemdb both use 200 for a miss, so status alone is not enough.
// A miss is printed under ORIGINALS and then dropped. We do not
// build an empty normalized record for it.
//
// How many hits decides what FINAL is:
//   0 hits    no normalized records, and no final record
//   1 hit     that one normalized object is the final record
//   2 or 3    each hit is normalized, then the fields are merged
//
// The merge does not blend two strings together. For each field it
// walks Open Facts, then Go-UPC, then UPCitemdb, and keeps the first
// value that is not null. Open Facts is first because it is the food
// database: name, brand, quantity, category, image, and ingredients
// are usually better there. Go-UPC is second because it is the one
// that usually has a description. UPCitemdb fills whatever is still
// empty. An empty string from a source is stored as null, so it does
// not block the next source.

import { config } from "dotenv";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

// Same as the other scripts. Loads GO_UPC_API_KEY from .env.local
// in the current working directory. Run from the project root.
config({ path: ".env.local" });

const GO_UPC_API_KEY = process.env.GO_UPC_API_KEY;

// This order is the merge priority, and also the order sources are
// listed on the aggregated record. It is not the order of the HTTP
// calls. "as const" locks the three strings so a typo in a switch
// is a type error instead of a silent miss.
const sourceOrder = ["Open Facts", "Go-UPC", "UPCitemdb"] as const;

// "Open Facts" | "Go-UPC" | "UPCitemdb". Used everywhere a source
// name is stored, so a lookup and a normalizer cannot disagree
// about spelling.
type SourceName = (typeof sourceOrder)[number];

// One remote database. getUrl inserts the barcode. headers are
// copied onto the request unchanged.
type ProductSource = {
  name: SourceName;
  getUrl: (barcode: string) => string;
  headers: Record<string, string>;
};

// One finished lookup. status is null when we never got an HTTP
// response (offline, or we skipped Go-UPC because the key is missing).
// found is the strict product check, not response.ok.
// data is the parsed JSON when there was a JSON body.
// error is a real failure. A 404 miss leaves it unset.
type SourceResult = {
  source: SourceName;
  status: number | null;
  found: boolean;
  data?: unknown;
  error?: string;
};

// Same field list as open-food-facts.ts, so the ORIGINALS dump for
// that source matches what the standalone script prints. nutriments
// is requested on purpose so it shows up in the raw body. It is not
// copied onto the normalized record. Nutrition is only on this one
// source and the units are messy, so merging it would be a guess.
const openFactsFields = [
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

const sources: ProductSource[] = [
  {
    name: "Open Facts",
    getUrl: (barcode) =>
      // Path segment, then a fields query. encodeURIComponent is
      // redundant for digits and keeps the path safe if the input
      // check is ever loosened.
      `https://world.openfoodfacts.org/api/v3/product/${encodeURIComponent(barcode)}` +
      `?fields=${openFactsFields}`,
    headers: {
      "User-Agent": "BestBefore/0.1 (development playground)",
      Accept: "application/json",
    },
  },
  {
    name: "UPCitemdb",
    getUrl: (barcode) =>
      `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(barcode)}`,
    headers: {
      Accept: "application/json",
    },
  },
  {
    name: "Go-UPC",
    getUrl: (barcode) =>
      `https://go-upc.com/api/v1/code/${encodeURIComponent(barcode)}`,
    headers: {
      Authorization: `Bearer ${GO_UPC_API_KEY}`,
      Accept: "application/json",
    },
  },
];

// The shared shape. Every source is squeezed into these fields,
// and missing data is null rather than "" or a missing key.
// source says who this record came from, which the single-hit
// final record still needs. barcode is the code that source echoed,
// falling back to whatever the user typed.
// description is always null for Open Facts, because that API's
// product_name is a name, not a blurb, and we do not request a
// description field. ingredients is always null for UPCitemdb,
// because that API does not have an ingredient list.
type NormalizedProduct = {
  source: SourceName;
  barcode: string;
  name: string | null;
  brand: string | null;
  description: string | null;
  quantity: string | null;
  category: string | null;
  imageUrl: string | null;
  ingredients: string | null;
};

// The merged record, only built when two or more sources hit.
// barcode here is the code the user typed, not one source's rewrite
// of it. sources lists who contributed, in sourceOrder, so a reader
// can see the priority that filled the fields. There is no per-field
// "this came from X" map. Compare NORMALIZED against FINAL to see
// which value won.
type AggregatedProduct = {
  barcode: string;
  name: string | null;
  brand: string | null;
  description: string | null;
  quantity: string | null;
  category: string | null;
  imageUrl: string | null;
  ingredients: string | null;
  sources: SourceName[];
};

// The fields pick() is allowed to fill. source is an identity, not
// a product fact, and barcode on the aggregate is the typed code,
// so both are excluded from the merge loop.
type MergedField = Exclude<
  keyof NormalizedProduct,
  "source" | "barcode"
>;

const mergedFields: MergedField[] = [
  "name",
  "brand",
  "description",
  "quantity",
  "category",
  "imageUrl",
  "ingredients",
];

// True for a plain JSON object. Arrays and null are both
// typeof "object", and reading .product on either would throw
// or silently do the wrong thing.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Turns a JSON value into a trimmed string, or null when there is
// nothing worth keeping.
// Numbers are accepted because Go-UPC sends ean and upc as numbers.
// A finite check skips NaN and Infinity, which String() would turn
// into the words "NaN" and "Infinity".
// Anything that is not a string or a number becomes null, including
// objects, arrays, booleans, and actual JSON null.
// A string of only spaces becomes null. That matters for UPCitemdb,
// which sends description: "" on a lot of hits. An empty string must
// not win the merge over a real description from Go-UPC.
function asText(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// Barcode from the command line if one was passed, otherwise a
// prompt. argv[2] is the first user argument. argv[0] is node and
// argv[1] is the script path.
// Both paths require all digits, same rule as all-sources.ts.
async function readBarcode(): Promise<string> {
  const fromArgv = process.argv[2]?.trim();

  if (fromArgv) {
    if (!/^\d+$/.test(fromArgv)) {
      throw new Error("Barcode must contain digits only.");
    }

    return fromArgv;
  }

  const readline = createInterface({ input, output });

  try {
    const barcode = (await readline.question("Barcode: ")).trim();

    if (!barcode) {
      throw new Error("Barcode cannot be empty.");
    }

    if (!/^\d+$/.test(barcode)) {
      throw new Error("Barcode must contain digits only.");
    }

    return barcode;
  } finally {
    // Close even when the checks throw, or node waits on stdin
    // and the process never ends.
    readline.close();
  }
}

// The "200 and a product" test. A non-200 is an immediate miss,
// including Go-UPC's 404 and a null status from a network error.
// The body still has to be an object before any field is read.
function productWasFound(
  source: SourceName,
  status: number | null,
  data: unknown,
): boolean {
  if (status !== 200 || !isRecord(data)) {
    return false;
  }

  switch (source) {
    case "Open Facts":
      // result.id is how v3 reports the outcome. product_not_found
      // is still HTTP 200. product has to be an object too, because
      // a found id with no product has nothing to normalize.
      return (
        isRecord(data.result) &&
        data.result.id === "product_found" &&
        isRecord(data.product)
      );

    case "UPCitemdb":
      // total: 0 and items: [] is their miss, delivered as 200.
      // Both are checked so a total without an item, or an item
      // with a zero total, does not count.
      return (
        typeof data.total === "number" &&
        data.total > 0 &&
        Array.isArray(data.items) &&
        data.items.length > 0
      );

    case "Go-UPC":
      // By the time we are here the status is already 200. A product
      // object is the rest of their hit. An error payload would not
      // have one.
      return isRecord(data.product);
  }
}

// One GET. Does not throw. A failure comes back as found: false
// plus an error string, so the other sources still print.
async function querySource(
  source: ProductSource,
  barcode: string,
): Promise<SourceResult> {
  // Skip the call when we already know Go-UPC will answer 401.
  // Saves the quota and makes the missing-key case obvious.
  if (source.name === "Go-UPC" && !GO_UPC_API_KEY) {
    return {
      source: source.name,
      status: null,
      found: false,
      error: "GO_UPC_API_KEY is missing from .env.local",
    };
  }

  try {
    const response = await fetch(source.getUrl(barcode), {
      method: "GET",
      headers: source.headers,
    });

    let data: unknown;

    // HTML error pages and empty bodies throw inside response.json().
    // Keep the status and treat the body as missing.
    try {
      data = await response.json();
    } catch {
      data = undefined;
    }

    const found = productWasFound(source.name, response.status, data);

    return {
      source: source.name,
      status: response.status,
      found,
      data,
      // 404 is Go-UPC's normal miss. Any other non-OK status is a
      // real failure and gets a message. response.ok is true for
      // 200-299, so a found product leaves error unset.
      error:
        response.ok || response.status === 404
          ? undefined
          : `${response.status} ${response.statusText}`,
    };
  } catch (error) {
    // fetch threw before any status existed.
    return {
      source: source.name,
      status: null,
      found: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// UPCitemdb puts the product in items[0], not at the top of the body.
// Later items are other catalog rows for the same code. This playground
// only keeps the first, which is the one the trial endpoint ranks first.
// Returns null when the list is missing or the first entry is not an object.
function firstItem(data: Record<string, unknown>): Record<string, unknown> | null {
  if (!Array.isArray(data.items) || !isRecord(data.items[0])) {
    return null;
  }

  return data.items[0];
}

// Go-UPC specs are pairs: [["Weight", "15 oz"], ["Organic", "No"]].
// This is only a backup for quantity. netContent is preferred, and
// this runs when netContent is missing.
// The label has to contain a whole word (weight, size, volume,
// "net content", or quantity). A substring match would treat
// "Packsize detail" as a size, and that value is a serving note
// ("15g Portion = 1 Teaspoon"), not the jar. The first matching
// pair wins. The rest of specs stays in the raw body only.
function quantityFromSpecs(specs: unknown): string | null {
  if (!Array.isArray(specs)) {
    return null;
  }

  for (const entry of specs) {
    if (!Array.isArray(entry) || entry.length < 2) {
      continue;
    }

    const label = asText(entry[0]);
    const value = asText(entry[1]);

    if (
      label &&
      value &&
      /\b(weight|size|volume|net content|quantity)\b/i.test(label)
    ) {
      return value;
    }
  }

  return null;
}

// Go-UPC pack size. The live shape is { text: "1000.0 g", g: 1000 }.
// text is the human string. The numeric g field is a parsed gram
// count and is ignored, because quantity on our record is a string
// and other sources are strings too ("400.0 g").
function netContentText(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }

  return asText(value.text);
}

// UPCitemdb images is an array of URL strings, often empty.
// The first non-empty string is the image. Objects in that array
// are skipped by asText.
function firstImage(images: unknown): string | null {
  if (!Array.isArray(images)) {
    return null;
  }

  for (const image of images) {
    const url = asText(image);
    if (url) return url;
  }

  return null;
}

// Open Food Facts body -> flat record.
// The product fields live under data.product. data.code is a copy
// of the barcode at the top of the response, used if product.code
// is missing. The typed barcode is the last resort so the field is
// never null.
// brands is kept as one string. Open Food Facts sometimes joins
// several brands with commas, and splitting that is a later decision.
// categories is the human string ("Cocoa and hazelnuts spreads"),
// not categories_tags. The tags are language-prefixed ("en:spreads")
// and stay in the raw dump.
// description is null on purpose. There is no description in the
// field list, and product_name is the name.
function normalizeOpenFacts(
  data: Record<string, unknown>,
  barcode: string,
): NormalizedProduct {
  const product = isRecord(data.product) ? data.product : {};

  return {
    source: "Open Facts",
    barcode: asText(product.code) ?? asText(data.code) ?? barcode,
    name: asText(product.product_name),
    brand: asText(product.brands),
    description: null,
    quantity: asText(product.quantity),
    category: asText(product.categories),
    imageUrl: asText(product.image_front_url),
    ingredients: asText(product.ingredients_text),
  };
}

// UPCitemdb body -> flat record.
// title is their name, and it is often a reseller sentence rather
// than the short product name. brand is whatever they filed, which
// is sometimes the product line ("Nutella") rather than the company.
// description passes through asText, so "" becomes null.
// weight is the closer match to a pack size. size is only used when
// weight is missing or blank. Both are often blank.
// ingredients does not exist on this API.
function normalizeUpcItemDb(
  data: Record<string, unknown>,
  barcode: string,
): NormalizedProduct {
  const item = firstItem(data) ?? {};

  return {
    source: "UPCitemdb",
    barcode: asText(item.ean) ?? asText(item.upc) ?? barcode,
    name: asText(item.title),
    brand: asText(item.brand),
    description: asText(item.description),
    quantity: asText(item.weight) ?? asText(item.size),
    category: asText(item.category),
    imageUrl: firstImage(item.images),
    ingredients: null,
  };
}

// Go-UPC body -> flat record.
// Barcode preference is formattedEAN, then the top-level code string
// (the code we sent, zeros intact), then ean, then upc, then the
// typed barcode. ean and upc are last because they arrive as numbers
// and String(number) drops a leading zero.
// categoryPath is the full trail. Joining it with " > " matches the
// style UPCitemdb already uses. The leaf category is the fallback
// when the path is missing or empty.
// ingredients is an object with a text field, not a bare string.
// quantity is netContent.text, then a size-like specs pair.
function normalizeGoUpc(
  data: Record<string, unknown>,
  barcode: string,
): NormalizedProduct {
  const product = isRecord(data.product) ? data.product : {};
  const ingredients = isRecord(product.ingredients) ? product.ingredients : {};
  // asText drops non-strings and blanks. The filter narrows the
  // array to string[] so join is safe.
  const categoryPath = Array.isArray(product.categoryPath)
    ? product.categoryPath.map(asText).filter((part) => part !== null)
    : [];

  return {
    source: "Go-UPC",
    barcode:
      asText(product.formattedEAN) ??
      asText(data.code) ??
      asText(product.ean) ??
      asText(product.upc) ??
      barcode,
    name: asText(product.name),
    brand: asText(product.brand),
    description: asText(product.description),
    quantity: netContentText(product.netContent) ?? quantityFromSpecs(product.specs),
    category:
      categoryPath.length > 0
        ? categoryPath.join(" > ")
        : asText(product.category),
    imageUrl: asText(product.imageUrl),
    ingredients: asText(ingredients.text),
  };
}

// Picks the per-source mapper. Returns null if the body is not an
// object, which should not happen for a result that already passed
// productWasFound. The null is there so a bad body cannot throw in
// the print loop.
function normalize(
  source: SourceName,
  data: unknown,
  barcode: string,
): NormalizedProduct | null {
  if (!isRecord(data)) {
    return null;
  }

  switch (source) {
    case "Open Facts":
      return normalizeOpenFacts(data, barcode);
    case "UPCitemdb":
      return normalizeUpcItemDb(data, barcode);
    case "Go-UPC":
      return normalizeGoUpc(data, barcode);
  }
}

// First non-null value for one field, walking sourceOrder.
// A source that did not hit is simply not in products, so find
// returns undefined and that slot is skipped. A null field is
// skipped too, which is how Go-UPC's description fills in when
// Open Facts has none.
function pick(
  products: NormalizedProduct[],
  field: MergedField,
): string | null {
  for (const sourceName of sourceOrder) {
    const product = products.find((item) => item.source === sourceName);
    const value = product?.[field];
    if (value) return value;
  }

  return null;
}

// Builds the single merged record from two or more normalized hits.
// barcode is the user's code, not pick()'d, so the three sources
// cannot disagree about which code this row is for.
// sources is sourceOrder filtered down to who actually hit, which
// keeps Open Facts before Go-UPC before UPCitemdb even if the HTTP
// calls finished in another order.
// The cast is because barcode and sources are filled first and the
// field loop fills the rest. Every MergedField is assigned before
// the object is returned.
function aggregate(
  products: NormalizedProduct[],
  barcode: string,
): AggregatedProduct {
  const merged = {
    barcode,
    sources: sourceOrder.filter((name) =>
      products.some((product) => product.source === name),
    ),
  } as AggregatedProduct;

  for (const field of mergedFields) {
    merged[field] = pick(products, field);
  }

  return merged;
}

// Blank line, title, then a rule. Used for ORIGINALS, NORMALIZED,
// and FINAL so the three sections are easy to spot in a long dump.
function printHeading(title: string) {
  console.log();
  console.log(title);
  console.log("=".repeat(85));
}

// depth: null prints nested objects in full. colors is for a
// terminal and is ignored if the output is piped. undefined means
// the response had no JSON body.
function printData(value: unknown) {
  if (value === undefined) {
    console.log("(no body)");
    return;
  }

  console.dir(value, { depth: null, colors: true });
}

async function main() {
  const barcode = await readBarcode();

  console.log();
  console.log(`Barcode ${barcode}`);
  console.log("=".repeat(85));

  // All three at once. querySource never rejects, so one dead
  // source cannot fail the whole Promise.all.
  const results = await Promise.all(
    sources.map((source) => querySource(source, barcode)),
  );

  // Hits only. Order stays the same as the sources array because
  // filter keeps original order: Open Facts, UPCitemdb, Go-UPC.
  // The merge later re-sorts by sourceOrder, which is a different
  // sequence. The NORMALIZED section uses this filter order.
  const found = results.filter((result) => result.found);

  printHeading("ORIGINALS");

  // Every source is printed here, including misses, so a reader can
  // see why something was left out of NORMALIZED.
  for (const result of results) {
    const status = result.status !== null ? String(result.status) : "NETWORK ERROR";

    console.log();
    console.log(
      `[${result.source}]  HTTP ${status}  ${result.found ? "FOUND" : "NOT FOUND"}`,
    );
    console.log("-".repeat(85));

    if (result.error) {
      console.log(result.error);
    }

    printData(result.data);
  }

  // Normalize only the hits. flatMap drops the null that normalize()
  // returns for a body that is not an object.
  const normalized = found.flatMap((result) => {
    const product = normalize(result.source, result.data, barcode);
    return product ? [product] : [];
  });

  printHeading("NORMALIZED");

  if (normalized.length === 0) {
    console.log();
    console.log("No source returned a product, so there is nothing to normalize.");
  } else {
    for (const product of normalized) {
      console.log();
      console.log(`[${product.source}]`);
      console.log("-".repeat(85));
      printData(product);
    }
  }

  printHeading("FINAL");
  console.log();

  if (normalized.length === 0) {
    console.log("No final record.");
    return;
  }

  // One hit: do not run it through aggregate(). The final record
  // is the normalized object itself, including its source field.
  // Aggregating one record would only rename source to sources and
  // hide that nothing was merged.
  if (normalized.length === 1) {
    console.log(
      `${normalized[0].source} was the only source with a product, so this normalized record is the final one.`,
    );
    console.log();
    printData(normalized[0]);
    return;
  }

  const finalRecord = aggregate(normalized, barcode);

  console.log(
    `${finalRecord.sources.join(", ")} had a product. Each field keeps the first non-empty value, checking Open Facts, then Go-UPC, then UPCitemdb.`,
  );
  console.log();
  printData(finalRecord);
}

// Barcode validation throws land here. Lookup failures do not,
// because querySource turns them into results.
main().catch((error) => {
  console.error();
  console.error(
    "Normalizer failed:",
    error instanceof Error ? error.message : error,
  );

  process.exitCode = 1;
});
