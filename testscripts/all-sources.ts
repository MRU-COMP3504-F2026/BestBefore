export {};

import { config } from "dotenv";

config({ path: ".env.local" });

const GO_UPC_API_KEY = process.env.GO_UPC_API_KEY;

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

type ProductSource = {
  name: string;
  getUrl: (barcode: string) => string;
  headers: Record<string, string>;
};

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
      "User-Agent": "BestBefore/0.1 (development playground)",
      Accept: "application/json",
    },
  },

  {
    name: "UPCitemdb",
    getUrl: (barcode) =>
      `https://api.upcitemdb.com/prod/trial/lookup?upc=${barcode}`,
    headers: {
      Accept: "application/json",
    },
  },

  {
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

    if (!/^\d+$/.test(barcode)) {
      throw new Error(
        "Barcode must contain digits only."
      );
    }

    return barcode;
  } finally {
    readline.close();
  }
}

// --------------------------------------------------
// RESPONSE HELPERS
// --------------------------------------------------

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

function productWasFound(
  source: string,
  status: number | null,
  data: unknown
): boolean {
  if (status === null || !isRecord(data)) {
    return false;
  }

  switch (source) {
    case "Open Facts": {
      return (
        status === 200 &&
        isRecord(data.result) &&
        data.result.id === "product_found" &&
        isRecord(data.product)
      );
    }

    case "UPCitemdb": {
      return (
        status === 200 &&
        typeof data.total === "number" &&
        data.total > 0 &&
        Array.isArray(data.items) &&
        data.items.length > 0
      );
    }

    case "Go-UPC": {
      return (
        status === 200 &&
        isRecord(data.product)
      );
    }

    case "UPC Search API": {
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

function getNormalizedBarcode(
  source: string,
  data: unknown
): string | undefined {
  if (!isRecord(data)) {
    return undefined;
  }

  switch (source) {
    case "Open Facts": {
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

async function querySource(
  source: ProductSource,
  barcode: string
): Promise<SourceResult> {
  const start = performance.now();

  try {
    const response = await fetch(
      source.getUrl(barcode),
      {
        method: "GET",
        headers: source.headers,
      }
    );

    const responseTimeMs = Math.round(
      performance.now() - start
    );

    let data: unknown;

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
      error:
        response.ok || response.status === 404
          ? undefined
          : `${response.status} ${response.statusText}`,
    };
  } catch (error) {
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

  // Run all source lookups concurrently
  const results = await Promise.all(
    sources.map((source) =>
      querySource(source, barcode)
    )
  );

  // ------------------------------------------------
  // RAW RESULTS
  // ------------------------------------------------

  for (const result of results) {
    console.log();
    console.log(`[${result.source}]`);
    console.log("-".repeat(85));

    const status =
      result.status !== null
        ? result.status
        : "NETWORK ERROR";

    console.log(
      `HTTP: ${status} ${result.ok ? "✓" : "✗"}`
    );

    console.log(
      `Product: ${result.found ? "FOUND ✓" : "NOT FOUND ✗"}`
    );

    console.log(
      `Response time: ${result.responseTimeMs} ms`
    );

    if (result.normalizedBarcode) {
      console.log(
        `Returned barcode: ${result.normalizedBarcode}`
      );
    }

    if (result.error) {
      console.log(`Error: ${result.error}`);
    }

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

main().catch((error) => {
  console.error();
  console.error(
    "Playground failed:",
    error instanceof Error
      ? error.message
      : error
  );

  process.exitCode = 1;
});
