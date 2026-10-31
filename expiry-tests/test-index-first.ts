// Index-first strategy over the 50 fixture items. No database.
// Run it with:
//   npx tsx expiry-tests/test-index-first.ts [--fixture seed-items-2] [--semantic]
//
// Searches every FoodKeeper product by name, with our category as a
// +2 boost. See strategies.ts for how this differs from
// test-category-first.ts. Writes results/index-first.json, which
// compare-results.ts reads.

import { indexFirst, runStrategy, SEMANTIC, semanticStrategy } from "./strategies.js";

runStrategy(SEMANTIC ? semanticStrategy(indexFirst) : indexFirst);
