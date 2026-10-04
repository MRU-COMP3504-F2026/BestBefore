// Asks Open Food Facts, UPCitemdb, and Go-UPC for one barcode and
// prints each raw response plus a one-line summary table.
// Run it with: npx tsx testscripts/all-sources.ts
// It prompts for the barcode. It does not merge the three bodies.
// normalizer.ts is the script that turns hits into one record.
//
// The three lookups run at the same time. Each result records the
// HTTP status, whether a product was actually in the body, how long
// the call took, and the barcode the source echoed back.
//
// FOUND is not the same thing as HTTP 200.
//   Open Food Facts answers 200 for a miss. A hit has
//     result.id === "product_found" and a product object.
//   UPCitemdb answers 200 for a miss. A hit has total > 0 and a
//     non-empty items array.
//   Go-UPC uses 404 for a miss. A hit is 200 with a product object.
// A 404 is treated as a normal miss. Other non-OK statuses (401 bad
// key, 429 rate limit) are recorded as errors but still printed.

export {};

import { config } from "dotenv";

// Loads GO_UPC_API_KEY from .env.local in the current working
// directory. Run from the project root. Already-set shell variables
// are left alone. If the file is missing, Go-UPC is called with
// "Bearer undefined" and comes back 401.
config({ path: ".env.local" });

const GO_UPC_API_KEY = process.env.GO_UPC_API_KEY;

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

// One remote database. getUrl builds the request URL from the
// barcode the user typed. headers are sent as-is on every call.
type ProductSource = {
  name: string;
  getUrl: (barcode: string) => string;
  headers: Record<string, string>;
};

// What we keep after one lookup finishes, success or failure.
// status is null when fetch itself threw (DNS, offline, abort).
// ok is the HTTP response.ok flag, false on a network throw.
// found is the stricter "body contains a product" check.
// normalizedBarcode is only the code the source echoed, not a
// full product. The real field mapping lives in normalizer.ts.
// data is the parsed JSON, or undefined if the body was not JSON.
// error is set for real failures, and left unset for a plain 404.
type SourceResult = {
  source: string;
  status: number | null;
  ok: boolean;
  found: boolean;
  responseTimeMs: number;
  normalizedBarcode?: string;
  data?: unknown;
  error?: string;
};

// --------------------------------------------------
// OPEN FACTS FIELDS
// --------------------------------------------------

// Smaller list than open-food-facts.ts. This playground is for
// comparing the three sources, so ingredients and nutriments are
// left out to keep the dump readable. The normalizer asks for the
// longer list because it actually reads ingredients.
// product_type=all is added on the URL below so a non-food barcode
// (a book, a bottle of shampoo) is still returned.
const openFactsFields = [
  "code",
  "product_name",
  "brands",
  "quantity",
  "categories",
  "categories_tags",
  "image_front_url",
].join(",");

// --------------------------------------------------
// SOURCES
// --------------------------------------------------

const sources: ProductSource[] = [
  {
    name: "Open Facts",
    getUrl: (barcode) =>
      `https://world.openfoodfacts.org/api/v3/product/${barcode}` +
      `?product_type=all&fields=${openFactsFields}`,
    headers: {
      // Open Food Facts blocks clients that do not identify themselves.
      "User-Agent": "BestBefore/0.1 (development playground)",
      Accept: "application/json",
    },
  },

  {
    // Trial endpoint, no key. The parameter is named upc for both
    // UPC-A and EAN-13. A miss is still HTTP 200.
    name: "UPCitemdb",
    getUrl: (barcode) =>
      `https://api.upcitemdb.com/prod/trial/lookup?upc=${barcode}`,
    headers: {
      Accept: "application/json",
    },
  },

  {
    // Bearer token. A miss is HTTP 404, not an empty 200.
    name: "Go-UPC",
    getUrl: (barcode) =>
      `https://go-upc.com/api/v1/code/${barcode}`,
    headers: {
      Authorization: `Bearer ${GO_UPC_API_KEY}`,
      Accept: "application/json",
    },
  },
];

// --------------------------------------------------
// BARCODE INPUT
// --------------------------------------------------

// Reads one line from the terminal. Empty input and anything that
// is not all digits are rejected. Spaces around the code are trimmed
// so a pasted barcode with a trailing newline still works.
async function promptForBarcode(): Promise<string> {
  const readline = createInterface({
    input,
    output,
  });

  try {
    const barcode = (
      await readline.question("Barcode: ")
    ).trim();

    if (!barcode) {
      throw new Error("Barcode cannot be empty.");
    }

    // UPC, EAN-8, EAN-13, and GTIN-14 are all digits. Letters here
    // would be a QR payload or a typo, and none of these three
    // endpoints accept that.
    if (!/^\d+$/.test(barcode)) {
      throw new Error(
        "Barcode must contain digits only."
      );
    }

    return barcode;
  } finally {
    // Always close, including when the checks above throw, or the
    // process stays alive waiting on stdin.
    readline.close();
  }
}

// --------------------------------------------------
// RESPONSE HELPERS
// --------------------------------------------------

// JSON objects only. Arrays and null are both typeof "object" in
// JavaScript, and neither has the fields these checks read.
function isRecord(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

// --------------------------------------------------
// DETERMINE WHETHER PRODUCT WAS ACTUALLY FOUND
// --------------------------------------------------

// Status alone is a bad signal, so each source has its own check.
// Open Food Facts says "product_found". UPCitemdb reports a total
// and a non-empty items list. Go-UPC just includes a product object.
// "UPC Search API" is a leftover name from an earlier source that
// is no longer in the sources array. It stays so an old response
// shape would still be recognized if that source is put back.

function productWasFound(
  source: string,
  status: number | null,
  data: unknown
): boolean {
  // A network throw leaves status null. A non-JSON body leaves data
  // unset. Either way there is no product to read.
  if (status === null || !isRecord(data)) {
    return false;
  }

  switch (source) {
    case "Open Facts": {
      // result.id is the v3 way of saying what happened. The HTTP
      // status stays 200 for product_not_found. product must also
      // be an object, because a found id with no product is useless.
      return (
        status === 200 &&
        isRecord(data.result) &&
        data.result.id === "product_found" &&
        isRecord(data.product)
      );
    }

    case "UPCitemdb": {
      // total: 0 with items: [] is their miss, and it is still 200.
      // Both checks are here because a buggy payload could claim a
      // total without actually including the item.
      return (
        status === 200 &&
        typeof data.total === "number" &&
        data.total > 0 &&
        Array.isArray(data.items) &&
        data.items.length > 0
      );
    }

    case "Go-UPC": {
      // Their miss is 404, so 200 plus a product object is enough.
      // An error body at 200 would not have product, and this
      // returns false for that.
      return (
        status === 200 &&
        isRecord(data.product)
      );
    }

    case "UPC Search API": {
      // That API used 200 for both hits and errors, and put an
      // error key on the body when the code was unknown.
      return (
        status === 200 &&
        !("error" in data)
      );
    }

    default:
      return false;
  }
}

// --------------------------------------------------
// EXTRACT NORMALIZED BARCODE WHEN AVAILABLE
// --------------------------------------------------

// Pulls the barcode the source itself echoed, which can differ from
// what we typed (leading zeros, UPC vs EAN). This is only a code,
// not the product name or brand. Undefined means the body had no
// code we recognize, which is normal on a miss.
function getNormalizedBarcode(
  source: string,
  data: unknown
): string | undefined {
  if (!isRecord(data)) {
    return undefined;
  }

  switch (source) {
    case "Open Facts": {
      // v3 puts code on the top-level object and again on product.
      // Top-level is checked first because it is present even on
      // some not-found payloads.
      if (typeof data.code === "string") {
        return data.code;
      }

      if (
        isRecord(data.product) &&
        typeof data.product.code === "string"
      ) {
        return data.product.code;
      }

      return undefined;
    }

    case "Go-UPC": {
      // formattedEAN is a string and keeps leading zeros.
      // data.code is the unformatted string we sent.
      // product.ean is often a number, so it is not read here;
      // turning it into a string can drop a leading zero.
      if (
        isRecord(data.product) &&
        typeof data.product.formattedEAN === "string"
      ) {
        return data.product.formattedEAN;
      }

      if (typeof data.code === "string") {
        return data.code;
      }

      return undefined;
    }

    case "UPCitemdb": {
      // The lookup returns a list. The first item is the one the
      // trial endpoint ranks as the match. ean is preferred over
      // upc because an EAN-13 is the longer, more specific code.
      if (
        Array.isArray(data.items) &&
        data.items.length > 0 &&
        isRecord(data.items[0])
      ) {
        const item = data.items[0];

        if (typeof item.ean === "string") {
          return item.ean;
        }

        if (typeof item.upc === "string") {
          return item.upc;
        }
      }

      return undefined;
    }

    case "UPC Search API": {
      if (typeof data.upc === "string") {
        return data.upc;
      }

      return undefined;
    }

    default:
      return undefined;
  }
}

// --------------------------------------------------
// QUERY A SINGLE SOURCE
// --------------------------------------------------

// One HTTP GET. Never throws. Network failures and bad JSON become
// a SourceResult with found: false and an error string, so one dead
// source does not cancel the other two.
async function querySource(
  source: ProductSource,
  barcode: string
): Promise<SourceResult> {
  // performance.now() is monotonic. Date.now() can jump if the
  // clock changes mid-request.
  const start = performance.now();

  try {
    const response = await fetch(
      source.getUrl(barcode),
      {
        method: "GET",
        headers: source.headers,
      }
    );

    // Measured before parsing the body, so a huge nutriments blob
    // would not be counted. These three endpoints are small either way.
    const responseTimeMs = Math.round(
      performance.now() - start
    );

    let data: unknown;

    // A 404 or 500 sometimes has an HTML or empty body. Parsing
    // that throws. Treat it as "no JSON" and keep going, so the
    // status line still prints.
    try {
      data = await response.json();
    } catch {
      data = undefined;
    }

    const found = productWasFound(
      source.name,
      response.status,
      data
    );

    const normalizedBarcode =
      getNormalizedBarcode(source.name, data);

    return {
      source: source.name,
      status: response.status,
      ok: response.ok,
      found,
      responseTimeMs,
      normalizedBarcode,
      data,
      // A 404 is a normal miss, not a failure worth shouting about.
      // Anything else that is not ok is a real failure: bad key,
      // rate limit, server error.
      error:
        response.ok || response.status === 404
          ? undefined
          : `${response.status} ${response.statusText}`,
    };
  } catch (error) {
    // fetch threw before a response existed: offline, DNS, TLS.
    const responseTimeMs = Math.round(
      performance.now() - start
    );

    return {
      source: source.name,
      status: null,
      ok: false,
      found: false,
      responseTimeMs,
      error:
        error instanceof Error
          ? error.message
          : String(error),
    };
  }
}

// --------------------------------------------------
// MAIN
// --------------------------------------------------

async function main() {
  console.log();
  console.log("BestBefore Barcode Playground");
  console.log("=".repeat(85));

  const barcode = await promptForBarcode();

  console.log();
  console.log(`Testing barcode: ${barcode}`);
  console.log("=".repeat(85));

  // Promise.all runs the three lookups together. They do not depend
  // on each other. One rejection cannot happen here because
  // querySource catches its own errors.
  const results = await Promise.all(
    sources.map((source) =>
      querySource(source, barcode)
    )
  );

  // ------------------------------------------------
  // RAW RESULTS
  // ------------------------------------------------

  // One block per source, in the same order as the sources array,
  // not in the order the responses arrived. The summary table below
  // uses that same order.
  for (const result of results) {
    console.log();
    console.log(`[${result.source}]`);
    console.log("-".repeat(85));

    // null status means fetch threw. Show that instead of a blank code.
    const status =
      result.status !== null
        ? result.status
        : "NETWORK ERROR";

    // The check mark is HTTP success only. A 200 miss still gets
    // a check here, and NOT FOUND on the next line.
    console.log(
      `HTTP: ${status} ${result.ok ? "✓" : "✗"}`
    );

    console.log(
      `Product: ${result.found ? "FOUND ✓" : "NOT FOUND ✗"}`
    );

    console.log(
      `Response time: ${result.responseTimeMs} ms`
    );

    // Omitted on a miss, where there is no echoed code.
    if (result.normalizedBarcode) {
      console.log(
        `Returned barcode: ${result.normalizedBarcode}`
      );
    }

    if (result.error) {
      console.log(`Error: ${result.error}`);
    }

    // Skipped when the body was not JSON, so we do not print undefined.
    if (result.data !== undefined) {
      console.log();
      console.dir(result.data, {
        depth: null,
        colors: true,
      });
    }
  }

  // ------------------------------------------------
  // SUMMARY
  // ------------------------------------------------

  // Fixed-width columns so the four rows line up in a terminal.
  // padEnd counts characters, which is fine because none of these
  // labels are wide Unicode.
  console.log();
  console.log("=".repeat(85));
  console.log("SUMMARY");
  console.log("-".repeat(85));

  console.log(
    `${"SOURCE".padEnd(22)}` +
    `${"HTTP".padEnd(10)}` +
    `${"PRODUCT".padEnd(14)}` +
    `${"TIME".padEnd(12)}` +
    `BARCODE`
  );

  console.log("-".repeat(85));

  for (const result of results) {
    const status =
      result.status !== null
        ? result.status.toString()
        : "ERROR";

    const productStatus =
      result.found
        ? "FOUND"
        : "NOT FOUND";

    console.log(
      `${result.source.padEnd(22)}` +
      `${status.padEnd(10)}` +
      `${productStatus.padEnd(14)}` +
      `${`${result.responseTimeMs} ms`.padEnd(12)}` +
      `${result.normalizedBarcode ?? "-"}`
    );
  }

  console.log("=".repeat(85));
}

// --------------------------------------------------
// RUN
// --------------------------------------------------

// A throw from promptForBarcode (empty input, letters) lands here.
// Query failures do not, because querySource returns them as data.
main().catch((error) => {
  console.error();
  console.error(
    "Playground failed:",
    error instanceof Error
      ? error.message
      : error
  );

  // Non-zero so a shell script can tell the run failed. Setting
  // exitCode lets the process finish printing before it exits.
  process.exitCode = 1;
});
