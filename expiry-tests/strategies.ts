// The two search strategies, and the runner both strategy tests use.
// Not meant to be run on its own. test-index-first.ts and
// test-category-first.ts each call runStrategy with one of these.
//
// Both strategies use the same scoring in foodkeeper.ts and the same
// prediction in expiry.ts. The only difference is which products are
// allowed to compete:
//
//   index-first     every product that shares a word with the name.
//                   Our category adds CATEGORY_BOOST to products in
//                   the matching FoodKeeper categories. This is what
//                   match-seeded.ts does.
//
//   category-first  only products in the matching FoodKeeper
//                   categories. If none of them shares a word with the
//                   name, it falls back to the index-first search, so
//                   an item is never left with no match just because
//                   the category had nothing. An item with no category
//                   (or one CATEGORY_HINTS does not know) goes straight
//                   to the fallback.
//
// The runner reads fixtures/seed-items.json, never the database, and
// writes results/<strategy>.json for compare-results.ts to read.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CONFIDENT_GAP,
  MIN_CONFIDENT_SCORE,
  categoryHints,
  formatDay,
  parseDay,
  recommend,
  unitWords,
  type Confidence,
  type Prediction,
} from "./expiry.js";
import { FoodKeeper, type Match } from "./foodkeeper.js";
import {
  applySemantics,
  calibrate,
  expand,
  type SemanticExpansion,
  type SemanticOptions,
} from "./semantic-expansion.js";

export const FOODKEEPER_PATH = fileURLToPath(new URL("./foodkeeper.json", import.meta.url));
// Which fixture set to run. Pass `--fixture seed-items-2` to any test
// (or to compare-results.ts) to use fixtures/seed-items-2.json. The
// default set writes to results/ as before; any other set writes to
// results/<name>/, so runs on different sets never overwrite each other.
export const FIXTURE_NAME = fixtureArg() ?? "seed-items";
const FIXTURE_PATH = fileURLToPath(new URL(`./fixtures/${FIXTURE_NAME}.json`, import.meta.url));
export const RESULTS_DIR = fileURLToPath(
  new URL(FIXTURE_NAME === "seed-items" ? "./results/" : `./results/${FIXTURE_NAME}/`, import.meta.url),
);

// --semantic runs the "+semantic" variant of a test instead of the
// plain one. It writes to <strategy>+semantic.json next to the plain
// result, so both can be compared.
export const SEMANTIC = process.argv.includes("--semantic");

function fixtureArg(): string | undefined {
  const position = process.argv.indexOf("--fixture");
  return position >= 0 ? process.argv[position + 1] : undefined;
}

// Same as match-seeded.ts. Enough rounds that the per-search average
// is steady, not the cost of the first few JIT-cold calls.
export const SEARCH_ROUNDS = 1000;

// Asked of every search, so ties wider than the 3 shown can still be
// broken by recommend() before it trims to 3.
const SEARCH_LIMIT = 10;

// Every column of inventory_items, plus the answer key. Dates are
// strings because that is how they come out of JSON, and how the
// date columns come out of Drizzle.
export type FixtureItem = {
  id: number;
  name: string;
  brand: string | null;
  barcode: string | null;
  category: string | null;
  quantity: number;
  unit: string | null;
  purchaseDate: string;
  bestBefore: string;
  createdAt: string;
  expectedFoodKeeperId: number;
  expectedFoodKeeperName: string;
  labelNote?: string;
};

// What a strategy hands back. usedFallback is only ever true for
// category-first, when nothing in the category matched.
export type StrategyResult = {
  matches: Match[];
  usedFallback: boolean;
};

// full is the list confidence is measured against: the index-first
// search for the same item. Omitted when search already is that.
// semantic is set only on the "+semantic" variants.
export type Strategy = {
  name: string;
  search: (foodKeeper: FoodKeeper, item: FixtureItem) => StrategyResult;
  full?: (foodKeeper: FoodKeeper, item: FixtureItem) => Match[];
  semantic?: { base: "index" | "category"; options: SemanticOptions };
};

// Same options for both strategies, so the only difference between
// them is onlyCategories. familyWords is empty except on the semantic
// layer's second search.
function searchOptions(item: FixtureItem, familyWords: readonly string[] = []) {
  return {
    hints: categoryHints(item.category),
    extraWords: unitWords(item.unit),
    familyWords,
    limit: SEARCH_LIMIT,
  };
}

export function fullSearch(foodKeeper: FoodKeeper, item: FixtureItem, familyWords: readonly string[] = []): Match[] {
  return foodKeeper.search(item.name, searchOptions(item, familyWords));
}

function categorySearch(foodKeeper: FoodKeeper, item: FixtureItem, familyWords: readonly string[] = []): StrategyResult {
  const options = searchOptions(item, familyWords);

  if (options.hints.length > 0) {
    const matches = foodKeeper.search(item.name, { ...options, onlyCategories: new Set(options.hints) });
    if (matches.length > 0) return { matches, usedFallback: false };
  }

  return { matches: fullSearch(foodKeeper, item, familyWords), usedFallback: true };
}

export const indexFirst: Strategy = {
  name: "index-first",
  search: (foodKeeper, item) => ({ matches: fullSearch(foodKeeper, item), usedFallback: false }),
};

export const categoryFirst: Strategy = {
  name: "category-first",
  search: (foodKeeper, item) => categorySearch(foodKeeper, item),
  full: (foodKeeper, item) => fullSearch(foodKeeper, item),
};

const FROZEN_CATEGORY = 8;

// The semantic pipeline for one strategy, on one item:
//   1. the original search, exactly as the plain strategy runs it
//   2. the same search with the item's family words, if it has any
//   3. a search of "Food Purchased Frozen" only, if the item is
//      explicitly frozen
//   4. applySemantics merges the lists by ID and applies the evidence
//      nudges. Nothing from step 1 is dropped.
export function semanticSearch(
  foodKeeper: FoodKeeper,
  item: FixtureItem,
  base: "index" | "category",
  options: SemanticOptions = {},
): StrategyResult & { expansion: SemanticExpansion } {
  const expansion = expand(item, options);
  const run = (target: FixtureItem, familyWords: readonly string[]): StrategyResult =>
    base === "index"
      ? { matches: fullSearch(foodKeeper, target, familyWords), usedFallback: false }
      : categorySearch(foodKeeper, target, familyWords);

  // A storage word in the name is storage evidence, not part of the
  // food. Left in, "frozen" matches the name of "Frozen pretzels" for
  // any frozen item. The original search (step 1) keeps the full name;
  // the added searches use the name without it, and the storage nudge
  // in applySemantics is what credits frozen rows instead.
  const storageWord = expansion.storage === "freezer" ? /\bfrozen\b/gi : null;
  const foodOnly = storageWord ? { ...item, name: item.name.replace(storageWord, "").trim() || item.name } : item;

  const original = run(item, []);
  const lists = [original.matches];
  if (expansion.familyWords.length > 0 || foodOnly !== item) lists.push(run(foodOnly, expansion.familyWords).matches);
  if (expansion.storage === "freezer") {
    lists.push(
      foodKeeper.search(foodOnly.name, {
        ...searchOptions(foodOnly, expansion.familyWords),
        onlyCategories: new Set([FROZEN_CATEGORY]),
      }),
    );
  }

  // Rows the original search found only through the storage word
  // ("Frozen pretzels" for "Frozen Peas") stay in the pool but rank
  // last. A row is "storage word only" when the name without that word
  // does not reach it at all.
  let storageWordOnly: ReadonlySet<number> | undefined;
  if (foodOnly !== item) {
    const reached = new Set(
      foodKeeper.search(foodOnly.name, { ...searchOptions(foodOnly), limit: foodKeeper.products.length }).map((m) => m.product.id),
    );
    storageWordOnly = new Set(original.matches.map((m) => m.product.id).filter((id) => !reached.has(id)));
  }

  return {
    matches: applySemantics(foodKeeper, item, expansion, lists, storageWordOnly),
    usedFallback: original.usedFallback,
    expansion,
  };
}

export function semanticStrategy(strategy: Strategy, options: SemanticOptions = {}): Strategy {
  const base = strategy.name === "index-first" ? "index" : "category";
  return {
    name: `${strategy.name}+semantic`,
    search: (foodKeeper, item) => semanticSearch(foodKeeper, item, base, options),
    full: base === "category" ? (foodKeeper, item) => semanticSearch(foodKeeper, item, "index", options).matches : undefined,
    semantic: { base, options },
  };
}

// indexRank and categoryRank are only set by the consensus run: the
// 1-based position this product had in each strategy's own list, or
// null when that strategy did not return it.
export type Candidate = {
  id: number;
  name: string;
  foodKeeperCategory: string;
  score: number;
  indexRank?: number | null;
  categoryRank?: number | null;
};

// One line of results/<strategy>.json. pick is null when not even the
// fallback found a product. inTop3 counts pick too, so correct always
// implies inTop3.
export type ItemResult = {
  id: number;
  name: string;
  category: string | null;
  expectedId: number;
  expectedName: string;
  pick: Candidate | null;
  candidates: Candidate[];
  correct: boolean;
  inTop3: boolean;
  confidence: Confidence | null;
  confidenceReason: string;
  usedFallback: boolean;
  predicted: string;
  seededBestBefore: string;
  searchMicros: number;
  // Consensus run only. The two existing runs leave these out, so
  // their JSON files are unchanged.
  resolution?: "consensus" | "reranked" | "averaged" | "no_match";
  // Semantic runs only: what the semantic layer saw and did, and which
  // parts of it changed the pick (each part switched off on its own).
  semanticNotes?: string[];
  familiesChangedPick?: boolean;
  storageChangedPick?: boolean;
  attributesChangedPick?: boolean;
  estimate?: boolean;
  averagedFrom?: { id: number; range: string }[];
  inRetrievalTop3?: boolean;
  inPool?: boolean;
};

export type RunSummary = {
  items: number;
  correct: number;
  inTop3: number;
  noMatch: number;
  fallbacks: number;
  accuracy: number;
  top3Accuracy: number;
  // Of the picks the strategy called high confidence, how many were
  // right. This is the number that decides whether auto-filling a
  // high-confidence match without asking is safe.
  highConfidence: number;
  highConfidenceCorrect: number;
  avgFirstSearchMicros: number;
  steadySearchMicros: number;
  // Consensus run only. compare-results.ts works out precision and
  // coverage for the other two from noMatch, which is always 0 there.
  averaged?: number;
  suggestionPrecision?: number;
  coverage?: number;
  retrievalTop3?: number;
  poolRecall?: number;
};

export type RunFile = {
  strategy: Strategy["name"] | "consensus";
  ranAt: string;
  referenceDate: string;
  summary: RunSummary;
  results: ItemResult[];
};

export function toCandidate(foodKeeper: FoodKeeper, match: Match): Candidate {
  const { product } = match;
  return {
    id: product.id,
    name: product.subtitle ? `${product.name} (${product.subtitle})` : product.name,
    foodKeeperCategory: foodKeeper.categoryLabel(product.categoryId),
    score: match.score,
  };
}

export function describePrediction(prediction: Prediction | undefined): string {
  if (!prediction) return "no match";

  switch (prediction.kind) {
    case "range":
      return `${formatDay(prediction.earliest)} to ${formatDay(prediction.latest)} (${prediction.label}, ${prediction.source})`;
    case "ask":
      return `ask user (${prediction.label}: ${prediction.detail})`;
    case "none":
      return `no date (${prediction.detail})`;
  }
}

export function percent(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10;
}

// One item, start to finish. Index-first is already the full search,
// so it is passed twice instead of searched twice.
export function recommendItem(foodKeeper: FoodKeeper, strategy: Strategy, item: FixtureItem) {
  const { matches, usedFallback } = strategy.search(foodKeeper, item);
  const full = usedFallback || !strategy.full ? matches : strategy.full(foodKeeper, item);

  if (!strategy.semantic) {
    return { result: recommend(foodKeeper, matches, full, parseDay(item.purchaseDate)), usedFallback, matches };
  }

  // Semantic: the explicit storage state picks the storage window, and
  // confidence is capped when the pick leans on family words or
  // contradicts the item.
  const expansion = expand(item, strategy.semantic.options);
  const result = recommend(foodKeeper, matches, full, parseDay(item.purchaseDate), expansion.storage ?? undefined);
  if (result) {
    const pick = result.matches[0];
    const rival = [...full, ...matches].find((match) => match.product.id !== pick.product.id);
    const capped = calibrate(result.confidence, pick, rival, MIN_CONFIDENT_SCORE, CONFIDENT_GAP);
    if (capped !== result.confidence) {
      result.reason += `; capped to ${capped}: ${pick.contradiction ? "contradicts the item" : "lead depends on family words"}`;
      result.confidence = capped as Confidence;
    }
  }
  return { result, usedFallback, matches };
}

// For a semantic run: the notes on the pick, and whether switching off
// each part of the layer on its own would have picked something else.
function semanticDetails(foodKeeper: FoodKeeper, strategy: Strategy, item: FixtureItem, best: Match | undefined) {
  const { base, options } = strategy.semantic!;
  const expansion = expand(item, options);
  const pickWithout = (off: SemanticOptions) => {
    const name = base === "index" ? "index-first" : "category-first";
    const ablated = semanticStrategy({ name, search: () => ({ matches: [], usedFallback: false }) }, { ...options, ...off });
    return recommendItem(foodKeeper, ablated, item).result?.matches[0]?.product.id;
  };
  const pick = best?.product.id;

  return {
    semanticNotes: [
      ...(expansion.families.length ? [`families: ${expansion.families.join(", ")}`] : []),
      ...(expansion.storage ? [`storage: ${expansion.storage} (${expansion.storageEvidence})`] : []),
      ...(expansion.attributes.length ? [`attributes: ${expansion.attributes.join(", ")}`] : []),
      ...(expansion.packaged ? ["packaged: brand or barcode"] : []),
      ...(best?.adjustments ?? []),
    ],
    familiesChangedPick: pickWithout({ families: false }) !== pick,
    storageChangedPick: pickWithout({ storage: false }) !== pick,
    attributesChangedPick: pickWithout({ attributes: false }) !== pick,
  };
}

export function loadFixture(): { referenceDate: string; items: FixtureItem[] } {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
}

// results/<name>.json, pretty-printed, with a trailing newline.
export function writeRun(run: RunFile): string {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const outPath = `${RESULTS_DIR}${run.strategy}.json`;
  writeFileSync(outPath, JSON.stringify(run, null, 2) + "\n");
  return outPath;
}

// Runs one strategy over every fixture item, prints a short line per
// item and a summary, and writes the full results file.
export function runStrategy(strategy: Strategy) {
  const foodKeeper = new FoodKeeper(FOODKEEPER_PATH);
  const fixture = loadFixture();

  const results: ItemResult[] = [];

  for (const item of fixture.items) {
    // Timed together: the search, the full search confidence is
    // measured against, and the tie-break, which predicts each tied
    // match. That is the whole per-item cost the engine would pay.
    const start = performance.now();
    const recommendation = recommendItem(foodKeeper, strategy, item);
    const searchMicros = (performance.now() - start) * 1000;

    const { usedFallback } = recommendation;
    const best = recommendation.result?.matches[0];
    const candidates = (recommendation.result?.matches ?? []).map((match) => toCandidate(foodKeeper, match));
    const expected = item.expectedFoodKeeperId;
    const semantic = strategy.semantic ? semanticDetails(foodKeeper, strategy, item, best) : {};

    results.push({
      id: item.id,
      name: item.name,
      category: item.category,
      expectedId: item.expectedFoodKeeperId,
      expectedName: item.expectedFoodKeeperName,
      pick: candidates[0] ?? null,
      candidates,
      correct: best?.product.id === item.expectedFoodKeeperId,
      inTop3: candidates.some((candidate) => candidate.id === item.expectedFoodKeeperId),
      confidence: recommendation.result?.confidence ?? null,
      confidenceReason: recommendation.result?.reason ?? "no match",
      usedFallback,
      predicted: describePrediction(recommendation.result?.prediction),
      seededBestBefore: item.bestBefore,
      searchMicros: Math.round(searchMicros * 10) / 10,
      // retrieval: the top 3 of the strategy's own list, before any
      // tiebreak. pool: anywhere in that list.
      inRetrievalTop3: recommendation.matches.slice(0, 3).some((match) => match.product.id === expected),
      inPool: recommendation.matches.some((match) => match.product.id === expected),
      ...semantic,
    });
  }

  const benchStart = performance.now();
  for (let round = 0; round < SEARCH_ROUNDS; round++) {
    for (const item of fixture.items) recommendItem(foodKeeper, strategy, item);
  }
  const steadySearchMicros = ((performance.now() - benchStart) * 1000) / (SEARCH_ROUNDS * fixture.items.length);

  const count = (test: (result: ItemResult) => boolean) => results.filter(test).length;
  const highConfidence = count((result) => result.confidence === "high");
  const correct = count((result) => result.correct);
  const inTop3 = count((result) => result.inTop3);

  const summary: RunSummary = {
    items: results.length,
    correct,
    inTop3,
    noMatch: count((result) => result.pick === null),
    fallbacks: count((result) => result.usedFallback),
    accuracy: percent(correct, results.length),
    top3Accuracy: percent(inTop3, results.length),
    highConfidence,
    highConfidenceCorrect: count((result) => result.confidence === "high" && result.correct),
    avgFirstSearchMicros:
      Math.round((results.reduce((sum, result) => sum + result.searchMicros, 0) / results.length) * 10) / 10,
    steadySearchMicros: Math.round(steadySearchMicros * 10) / 10,
    retrievalTop3: count((result) => result.inRetrievalTop3 === true),
    poolRecall: count((result) => result.inPool === true),
  };

  console.log();
  console.log(`${strategy.name.toUpperCase()}  (${results.length} fixture items)`);
  console.log("=".repeat(85));

  for (const result of results) {
    // ok    right pick
    // top3  wrong pick, but the right one is a candidate
    // MISS  the right one is not in the top 3 at all
    const mark = result.correct ? "ok  " : result.inTop3 ? "top3" : "MISS";
    const fallback = result.usedFallback ? "  [fallback]" : "";
    console.log(
      `${mark}  ${result.name.padEnd(26)} -> ${result.pick ? `#${result.pick.id} ${result.pick.name}` : "no match"}` +
        `${fallback}`,
    );
    if (!result.correct) {
      console.log(`${" ".repeat(34)}wanted #${result.expectedId} ${result.expectedName}`);
    }
  }

  console.log();
  console.log(`Correct            ${summary.correct}/${summary.items}  (${summary.accuracy}%)`);
  console.log(`Right one in top 3 ${summary.inTop3}/${summary.items}  (${summary.top3Accuracy}%)`);
  console.log(`High confidence    ${summary.highConfidenceCorrect}/${summary.highConfidence} of those were right`);
  console.log(`Retrieval top 3    ${summary.retrievalTop3}/${summary.items}`);
  console.log(`Pool recall        ${summary.poolRecall}/${summary.items}`);
  console.log(`Fallbacks          ${summary.fallbacks}`);
  console.log(`Search             ${summary.steadySearchMicros} µs steady avg, ${summary.avgFirstSearchMicros} µs first call`);

  const run: RunFile = {
    strategy: strategy.name,
    ranAt: new Date().toISOString(),
    referenceDate: fixture.referenceDate,
    summary,
    results,
  };

  const outPath = writeRun(run);
  console.log();
  console.log(`Wrote ${outPath}`);
}
