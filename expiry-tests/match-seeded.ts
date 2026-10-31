// Matches every seeded inventory item to a FoodKeeper product and
// prints how long it keeps.
// Run it from the project root with:
//   npx tsx expiry-tests/match-seeded.ts
//
// It reads inventory_items from the database in DATABASE_URL, the
// same one `npm run db:seed` fills. It only reads. Nothing is written
// back.
//
// For each item it prints:
//   MATCH       the best FoodKeeper product, its category, and the
//               score, with the next two candidates under it
//   CONFIDENCE  how far ahead the best match is. A tie or a small gap
//               is where the app should show the candidates and let
//               the user pick
//   STORAGE     every storage window FoodKeeper has for that product
//   PREDICTED   purchase date + the window's min and max, next to the
//               seeded best_before for comparison. Tagged [USDA] when
//               it comes straight from FoodKeeper, [estimated] when a
//               fallback below filled it in
//
// Matching is a word match on the item name only. See foodkeeper.ts
// for how scoring works. Our categories (Dairy, Produce, ...) are not
// FoodKeeper's, so CATEGORY_HINTS in expiry.ts maps one to the other. The
// hint only boosts a product that already matched a word.
//
// Storage is chosen from the matched product's FoodKeeper category,
// not ours. Ours is whatever the seed or the user typed, and it was
// sending fresh produce down the pantry path.
//
// TIMING at the end splits the work into loading the file, building
// the index, and searching. Search is the part the scan flow repeats,
// so it is also run SEARCH_ROUNDS times over every item to get a
// steady per-search average.

import { fileURLToPath } from "node:url";
import { asc } from "drizzle-orm";
import { db } from "../server/src/db/index.js";
import { inventoryItems } from "../server/src/db/schema.js";
import { categoryHints, describeWindow, formatDay, parseDay, recommend, unitWords } from "./expiry.js";
import { FoodKeeper, type Match } from "./foodkeeper.js";

// Resolved next to this file, so the script finds the JSON no matter
// which folder it is run from. The database env still loads from the
// working directory, which is why the run command says project root.
const FOODKEEPER_PATH = fileURLToPath(new URL("./foodkeeper.json", import.meta.url));

const SEARCH_ROUNDS = 1000;

function describeMatch(foodKeeper: FoodKeeper, match: Match): string {
  const { product } = match;
  const name = product.subtitle ? `${product.name} (${product.subtitle})` : product.name;
  return `#${product.id} ${name}  [${foodKeeper.categoryLabel(product.categoryId)}]  score ${match.score}`;
}

function printHeading(title: string) {
  console.log();
  console.log(title);
  console.log("=".repeat(85));
}

function ms(start: number, end: number): string {
  return `${(end - start).toFixed(2)} ms`;
}

async function main() {
  const loadStart = performance.now();
  const foodKeeper = new FoodKeeper(FOODKEEPER_PATH);
  const loadEnd = performance.now();

  // Built inside the constructor, so this line times load + index
  // together. Splitting them would mean a second public method that
  // only the timing uses.
  console.log(
    `Loaded ${foodKeeper.products.length} products, ${foodKeeper.categories.size} categories, ` +
      `${foodKeeper.indexSize} indexed words in ${ms(loadStart, loadEnd)}`,
  );

  const items = await db.select().from(inventoryItems).orderBy(asc(inventoryItems.id));

  if (items.length === 0) {
    console.log();
    console.log("No rows in inventory_items. Run `npm run db:seed` first.");
    return;
  }

  const searchTimes: number[] = [];

  // Index-first, the same search test-index-first.ts runs. The limit
  // is above 3 so recommend() can break a tie wider than what it shows.
  const searchFor = (item: (typeof items)[number]) =>
    foodKeeper.search(item.name, {
      hints: categoryHints(item.category),
      extraWords: unitWords(item.unit),
      limit: 10,
    });

  for (const item of items) {
    const searchStart = performance.now();
    const matches = searchFor(item);
    const recommendation = recommend(foodKeeper, matches, matches, parseDay(item.purchaseDate));
    const searchEnd = performance.now();
    searchTimes.push(searchEnd - searchStart);

    printHeading(
      `${item.name}${item.brand ? ` (${item.brand})` : ""}  category ${item.category ?? "none"}  ` +
        `bought ${item.purchaseDate}`,
    );

    if (!recommendation) {
      console.log("MATCH      none. No FoodKeeper product shares a word with this name.");
      continue;
    }

    const [best, ...others] = recommendation.matches;

    console.log(`MATCH      ${describeMatch(foodKeeper, best)}`);
    for (const other of others) {
      console.log(`  also     ${describeMatch(foodKeeper, other)}`);
    }
    console.log(`CONFIDENCE ${recommendation.confidence} (${recommendation.reason})`);

    const windows = foodKeeper.storageWindows(best.product);

    console.log();
    if (windows.length === 0) {
      console.log("STORAGE    FoodKeeper has no storage times for this product.");
    }
    for (const window of windows) {
      console.log(`STORAGE    ${window.label.padEnd(26)} ${describeWindow(window)}`);
    }

    const { prediction } = recommendation;

    console.log();
    switch (prediction.kind) {
      case "range":
        console.log(
          `PREDICTED  ${prediction.label}: ${formatDay(prediction.earliest)} to ${formatDay(prediction.latest)}  ` +
            `(${prediction.detail})  [${prediction.source}]`,
        );
        break;
      case "ask":
        console.log(`PREDICTED  ${prediction.label}: no date, ${prediction.detail}  [ask user]`);
        break;
      case "none":
        console.log(`PREDICTED  no date, ${prediction.detail}`);
        break;
    }
    console.log(`           seeded best_before ${item.bestBefore}`);
  }

  // Warm-up is the loop above, so this measures steady-state search,
  // not the first-call cost of the JIT.
  const benchStart = performance.now();
  for (let round = 0; round < SEARCH_ROUNDS; round++) {
    for (const item of items) {
      const matches = searchFor(item);
      recommend(foodKeeper, matches, matches, parseDay(item.purchaseDate));
    }
  }
  const benchEnd = performance.now();
  const searches = SEARCH_ROUNDS * items.length;

  printHeading("TIMING");
  console.log(`Load + index         ${ms(loadStart, loadEnd)}  (once per process)`);
  searchTimes.forEach((time, position) => {
    console.log(`Search ${items[position].name.padEnd(22)} ${time.toFixed(3)} ms  (first call)`);
  });
  console.log(
    `Steady-state search  ${(((benchEnd - benchStart) / searches) * 1000).toFixed(1)} µs avg ` +
      `over ${searches} searches`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
