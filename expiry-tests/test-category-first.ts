// Category-first strategy over the 50 fixture items. No database.
// Run it with:
//   npx tsx expiry-tests/test-category-first.ts [--fixture seed-items-2] [--semantic]
//
// Searches only the FoodKeeper categories our category maps to, and
// falls back to the full search when nothing there shares a word with
// the name. See strategies.ts for how this differs from
// test-index-first.ts. Writes results/category-first.json, which
// compare-results.ts reads.

import { categoryFirst, runStrategy, SEMANTIC, semanticStrategy } from "./strategies.js";

runStrategy(SEMANTIC ? semanticStrategy(categoryFirst) : categoryFirst);
