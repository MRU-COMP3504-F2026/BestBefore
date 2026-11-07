// Dual-search consensus over the 50 fixture items, then targeted
// checks of each decision rule. No database.
// Run it from the project root with:
//   npx tsx expiry-tests/test-consensus.ts
//
// Uses the same fixtures/seed-items.json and expected FoodKeeper IDs
// as the other two tests. See consensus.ts for how it decides.
//
// Prints:
//   CONSENSUS       one line per item, like the other two tests
//   SUMMARY         the headline numbers
//   VS EXISTING     items consensus fixed or broke compared with
//                   index-first and category-first, run live here so
//                   the comparison never reads stale result files
//   TARGETED TESTS  PASS / FAIL for each rule, on hand-built inputs
//
// Writes results/consensus.json in the same shape as the other two,
// plus resolution, estimate, and averagedFrom on each item. Exits
// with code 1 if any targeted test fails.

import {
  consensus,
  describeCandidate,
  describeRange,
  NEAR_TIE_MARGIN,
  NO_SUGGESTION_MESSAGE,
  type ConsensusResult,
} from "./consensus.js";
import { CONFIDENT_GAP, MIN_CONFIDENT_SCORE, categoryHints, formatDay, parseDay } from "./expiry.js";
import { FoodKeeper, type Match } from "./foodkeeper.js";
import { calibrate, expand, type SemanticOptions } from "./semantic-expansion.js";
import {
  categoryFirst,
  FOODKEEPER_PATH,
  indexFirst,
  loadFixture,
  percent,
  recommendItem,
  SEARCH_ROUNDS,
  SEMANTIC,
  semanticSearch,
  semanticStrategy,
  writeRun,
  type Candidate,
  type FixtureItem,
  type ItemResult,
  type RunSummary,
} from "./strategies.js";

function printHeading(title: string) {
  console.log();
  console.log(title);
  console.log("=".repeat(85));
}

// Both searches, then the merge. The FoodKeeper index is built once
// by the caller and reused, so nothing is parsed per item. The raw
// lists come back too, for the retrieval-recall numbers.
// With --semantic, both lists come from the semantic layer, the
// explicit storage state picks the storage window, and confidence is
// capped the same way as the other two semantic runs.
function consensusForItem(
  foodKeeper: FoodKeeper,
  item: FixtureItem,
  nearTieMargin = NEAR_TIE_MARGIN,
  semanticOptions: SemanticOptions = {},
) {
  const index = SEMANTIC ? semanticSearch(foodKeeper, item, "index", semanticOptions) : indexFirst.search(foodKeeper, item);
  const category = SEMANTIC
    ? semanticSearch(foodKeeper, item, "category", semanticOptions)
    : categoryFirst.search(foodKeeper, item);
  const storage = SEMANTIC ? expand(item, semanticOptions).storage ?? undefined : undefined;
  const result = consensus(foodKeeper, index.matches, category.matches, parseDay(item.purchaseDate), {
    nearTieMargin,
    categoryHints: categoryHints(item.category),
    preferredStorage: storage,
  });
  if (SEMANTIC && result.selected) {
    const [pick, rival] = result.candidates;
    const capped = calibrate(result.confidence, pick, rival, MIN_CONFIDENT_SCORE, CONFIDENT_GAP);
    if (capped !== result.confidence) {
      result.reason += `; capped to ${capped}: ${pick.contradiction ? "contradicts the item" : "lead depends on family words"}`;
      result.confidence = capped;
    }
  }
  return {
    result,
    index: index.matches,
    category: category.matches,
    usedFallback: category.usedFallback,
  };
}

function toResultCandidate(foodKeeper: FoodKeeper, candidate: ConsensusResult["candidates"][number]): Candidate {
  return {
    id: candidate.product.id,
    name: describeCandidate(candidate),
    foodKeeperCategory: foodKeeper.categoryLabel(candidate.product.categoryId),
    score: candidate.score,
    indexRank: candidate.indexRank,
    categoryRank: candidate.categoryRank,
  };
}

// Same report as the semantic runs in strategies.ts: what the layer
// saw, the nudges on the pick, and which part changed the pick when
// switched off on its own.
function semanticDetails(foodKeeper: FoodKeeper, item: FixtureItem, result: ConsensusResult) {
  const expansion = expand(item);
  const pick = result.selected?.id;
  const without = (off: SemanticOptions) => consensusForItem(foodKeeper, item, NEAR_TIE_MARGIN, off).result.selected?.id;
  return {
    semanticNotes: [
      ...(expansion.families.length ? [`families: ${expansion.families.join(", ")}`] : []),
      ...(expansion.storage ? [`storage: ${expansion.storage} (${expansion.storageEvidence})`] : []),
      ...(expansion.attributes.length ? [`attributes: ${expansion.attributes.join(", ")}`] : []),
      ...(expansion.packaged ? ["packaged: brand or barcode"] : []),
      ...(result.candidates[0]?.adjustments ?? []),
    ],
    familiesChangedPick: without({ families: false }) !== pick,
    storageChangedPick: without({ storage: false }) !== pick,
    attributesChangedPick: without({ attributes: false }) !== pick,
  };
}

function runBenchmark(foodKeeper: FoodKeeper) {
  const fixture = loadFixture();
  const results: ItemResult[] = [];

  for (const item of fixture.items) {
    const start = performance.now();
    const { result, usedFallback, index, category } = consensusForItem(foodKeeper, item);
    const searchMicros = (performance.now() - start) * 1000;

    // Three recall levels, so a loss can be traced to where it happens:
    //   retrieval  in the top 3 of either raw search list
    //   pool       anywhere in the merged pool, credible or dropped
    //   final      in the top 3 consensus reports (inTop3 below)
    const expected = item.expectedFoodKeeperId;
    const inRetrievalTop3 = [index, category].some((list) =>
      list.slice(0, 3).some((match) => match.product.id === expected),
    );
    const inPool = [...result.candidates, ...result.dropped].some((candidate) => candidate.product.id === expected);

    const candidates = result.candidates.slice(0, 3).map((candidate) => toResultCandidate(foodKeeper, candidate));
    const pick = result.selected
      ? candidates.find((candidate) => candidate.id === result.selected!.id) ?? null
      : null;

    results.push({
      id: item.id,
      name: item.name,
      category: item.category,
      expectedId: item.expectedFoodKeeperId,
      expectedName: item.expectedFoodKeeperName,
      pick,
      candidates,
      correct: result.selected?.id === item.expectedFoodKeeperId,
      inTop3: candidates.some((candidate) => candidate.id === item.expectedFoodKeeperId),
      confidence: result.confidence,
      confidenceReason: result.reason,
      usedFallback,
      predicted: result.resolution === "no_match" ? `no suggestion (${result.message})` : describeRange(result.range),
      seededBestBefore: item.bestBefore,
      searchMicros: Math.round(searchMicros * 10) / 10,
      resolution: result.resolution,
      ...(SEMANTIC ? semanticDetails(foodKeeper, item, result) : {}),
      estimate: result.estimate,
      inRetrievalTop3,
      inPool,
      averagedFrom: result.averagedFrom.map((candidate) => ({
        id: candidate.product.id,
        range:
          candidate.prediction.kind === "range"
            ? `${formatDay(candidate.prediction.earliest)} to ${formatDay(candidate.prediction.latest)}`
            : candidate.prediction.kind,
      })),
    });
  }

  const benchStart = performance.now();
  for (let round = 0; round < SEARCH_ROUNDS; round++) {
    for (const item of fixture.items) consensusForItem(foodKeeper, item);
  }
  const steadySearchMicros = ((performance.now() - benchStart) * 1000) / (SEARCH_ROUNDS * fixture.items.length);

  const count = (test: (result: ItemResult) => boolean) => results.filter(test).length;
  const correct = count((result) => result.correct);
  const inTop3 = count((result) => result.inTop3);
  const highConfidence = count((result) => result.confidence === "high");
  const noMatch = count((result) => result.resolution === "no_match");
  const suggested = results.length - noMatch;

  const summary: RunSummary = {
    items: results.length,
    correct,
    inTop3,
    noMatch,
    fallbacks: count((result) => result.usedFallback),
    accuracy: percent(correct, results.length),
    top3Accuracy: percent(inTop3, results.length),
    highConfidence,
    highConfidenceCorrect: count((result) => result.confidence === "high" && result.correct),
    avgFirstSearchMicros:
      Math.round((results.reduce((sum, result) => sum + result.searchMicros, 0) / results.length) * 10) / 10,
    steadySearchMicros: Math.round(steadySearchMicros * 10) / 10,
    averaged: count((result) => result.resolution === "averaged"),
    suggestionPrecision: percent(correct, suggested),
    coverage: percent(suggested, results.length),
    retrievalTop3: count((result) => result.inRetrievalTop3 === true),
    poolRecall: count((result) => result.inPool === true),
  };

  printHeading(`CONSENSUS${SEMANTIC ? "+SEMANTIC" : ""}  (${results.length} fixture items)`);
  for (const result of results) {
    // Same marks as the other two tests, plus "----" for an abstain.
    const mark = result.correct ? "ok  " : result.resolution === "no_match" ? "----" : result.inTop3 ? "top3" : "MISS";
    console.log(
      `${mark}  ${result.name.padEnd(26)} -> ${result.pick ? `#${result.pick.id} ${result.pick.name}` : "no suggestion"}` +
        `  [${result.resolution}${result.confidence ? `, ${result.confidence}` : ""}]`,
    );
    if (!result.correct) {
      console.log(`${" ".repeat(34)}wanted #${result.expectedId} ${result.expectedName}`);
      console.log(`${" ".repeat(34)}${result.confidenceReason}`);
    }
  }

  printHeading("SUMMARY");
  console.log(`Accuracy           ${summary.correct}/${summary.items}  (${summary.accuracy}%)  correct of all items`);
  console.log(
    `Suggestion prec.   ${summary.correct}/${suggested}  (${summary.suggestionPrecision}%)  correct of suggestions made`,
  );
  console.log(`Coverage           ${suggested}/${summary.items}  (${summary.coverage}%)  items given a suggestion`);
  console.log(`Retrieval top 3    ${summary.retrievalTop3}/${summary.items}  in the top 3 of either raw search`);
  console.log(`Pool recall        ${summary.poolRecall}/${summary.items}  anywhere in the merged pool`);
  console.log(`Final top 3        ${summary.inTop3}/${summary.items}  (${summary.top3Accuracy}%)  in consensus's own top 3`);
  console.log(
    `High confidence    ${summary.highConfidenceCorrect}/${summary.highConfidence} right, ` +
      `covering ${summary.highConfidence}/${summary.items} items (${percent(summary.highConfidence, summary.items)}%)`,
  );
  console.log(`Abstained          ${summary.noMatch}  (not counted as correct, but not a wrong suggestion either)`);
  console.log(`Averaged           ${summary.averaged}`);
  console.log(`Search             ${summary.steadySearchMicros} µs steady avg, ${summary.avgFirstSearchMicros} µs first call`);

  // Live, not read from results/, so this section is right even if
  // the other two tests were never run.
  printHeading("VS EXISTING");
  const existingStrategies = SEMANTIC
    ? [semanticStrategy(indexFirst), semanticStrategy(categoryFirst)]
    : [indexFirst, categoryFirst];
  for (const strategy of existingStrategies) {
    const existing = new Map(
      fixture.items.map((item) => [
        item.id,
        recommendItem(foodKeeper, strategy, item).result?.matches[0]?.product.id === item.expectedFoodKeeperId,
      ]),
    );
    const fixed = results.filter((result) => result.correct && !existing.get(result.id));
    const broke = results.filter((result) => !result.correct && existing.get(result.id));
    console.log(`Fixed vs ${strategy.name}:  ${fixed.length}${fixed.length ? `  (${fixed.map((r) => r.name).join(", ")})` : ""}`);
    console.log(`Broke vs ${strategy.name}:  ${broke.length}${broke.length ? `  (${broke.map((r) => r.name).join(", ")})` : ""}`);
  }

  // Sensitivity of the one tuning knob. Only the margin changes; the
  // searches are the same, so this is cheap.
  console.log();
  for (const margin of [0, 1, 2]) {
    let right = 0;
    let abstained = 0;
    let averaged = 0;
    for (const item of fixture.items) {
      const { result } = consensusForItem(foodKeeper, item, margin);
      if (result.selected?.id === item.expectedFoodKeeperId) right++;
      if (result.resolution === "no_match") abstained++;
      if (result.resolution === "averaged") averaged++;
    }
    console.log(
      `Near-tie margin ${margin}${margin === NEAR_TIE_MARGIN ? " (default)" : ""}:  ` +
        `${right}/${fixture.items.length} correct, ${abstained} abstained, ${averaged} averaged`,
    );
  }

  const outPath = writeRun({
    strategy: SEMANTIC ? "consensus+semantic" : "consensus",
    ranAt: new Date().toISOString(),
    referenceDate: fixture.referenceDate,
    summary,
    results,
  });
  console.log();
  console.log(`Wrote ${outPath}`);
}

// Targeted tests. Each builds the two search lists by hand from real
// FoodKeeper rows, so a rule is tested on exactly the input it is
// about, not on whatever the fixtures happen to produce.
function runTargetedTests(foodKeeper: FoodKeeper): number {
  const bought = parseDay("2026-10-31");
  const byId = new Map(foodKeeper.products.map((product) => [product.id, product]));

  const match = (id: number, score: number, headHit = true): Match => {
    const product = byId.get(id);
    if (!product) throw new Error(`Test setup: FoodKeeper ID ${id} does not exist`);
    return { product, score, headHit };
  };

  const days = (result: ConsensusResult) =>
    result.range
      ? [
          Math.round((result.range.earliest.getTime() - bought.getTime()) / 86400000),
          Math.round((result.range.latest.getTime() - bought.getTime()) / 86400000),
        ]
      : null;

  let failures = 0;
  const check = (name: string, result: ConsensusResult, expectations: [string, boolean][]) => {
    const failed = expectations.filter(([, ok]) => !ok).map(([label]) => label);
    if (failed.length === 0) {
      console.log(`PASS  ${name}`);
      return;
    }
    failures++;
    console.log(`FAIL  ${name}`);
    console.log(`        failed: ${failed.join("; ")}`);
    console.log(
      `        got: ${result.resolution}, #${result.selected?.id ?? "none"}, ${result.confidence}, ` +
        `${describeRange(result.range)}, ${result.reason}`,
    );
  };

  printHeading("TARGETED TESTS");

  // 1. Yogurt on top of both lists, well ahead.
  {
    const result = consensus(foodKeeper, [match(33, 8), match(29, 4)], [match(33, 8), match(29, 4)], bought);
    check("both agree, strong", result, [
      ["resolution consensus", result.resolution === "consensus"],
      ["picks #33", result.selected?.id === 33],
      ["high confidence", result.confidence === "high"],
    ]);
  }

  // 2. Both agree on deli turkey, but it only scored 3.
  {
    const result = consensus(foodKeeper, [match(514, 3)], [match(514, 3)], bought);
    check("both agree, weak", result, [
      ["resolution consensus", result.resolution === "consensus"],
      ["picks #514", result.selected?.id === 514],
      ["not high: agreement alone is not enough", result.confidence === "low"],
    ]);
  }

  // 3. Index-first has white flour well ahead. Category-first only
  //    saw tortillas, because its filter dropped the flour row.
  {
    const result = consensus(foodKeeper, [match(222, 8), match(196, 4)], [match(196, 4)], bought);
    check("disagree, clear winner", result, [
      ["resolution reranked", result.resolution === "reranked"],
      ["picks #222", result.selected?.id === 222],
      ["high confidence", result.confidence === "high"],
    ]);
  }

  // 4. Asparagus 3-4, broccoli 3-5, cucumbers 4-6 days, all fresh
  //    vegetables in the fridge. Lower bounds 3,3,4 -> 3; upper
  //    bounds 4,5,6 -> 5.
  {
    const result = consensus(foodKeeper, [match(271, 6), match(276, 6), match(283, 5)], [], bought);
    const range = days(result);
    check("three compatible near-ties are averaged", result, [
      ["resolution averaged", result.resolution === "averaged"],
      ["3-5 days", range?.[0] === 3 && range?.[1] === 5],
      ["is an estimate", result.estimate],
      ["keeps all three sources", result.averagedFrom.map((c) => c.product.id).sort().join() === "271,276,283"],
      ["not high confidence", result.confidence !== "high"],
    ]);
  }

  // 5. Garlic 3-14, corn 1-2, broccoli 3-5 days. Same storage and
  //    category, but the ranges are nowhere near each other.
  {
    const result = consensus(foodKeeper, [match(285, 6), match(282, 6), match(276, 6)], [], bought);
    check("incompatible ranges abstain", result, [
      ["resolution no_match", result.resolution === "no_match"],
      ["says the ranges diverge", result.reason.includes("diverge")],
      ["no date", result.range === null],
    ]);
  }

  // 6. Dry pasta and rice are pantry; fresh pasta is fridge.
  {
    const result = consensus(foodKeeper, [match(335, 6), match(332, 6), match(338, 6)], [], bought);
    check("different storage methods abstain", result, [
      ["resolution no_match", result.resolution === "no_match"],
      ["says storage differs", result.reason.includes("storage")],
    ]);
  }

  // 7. Nothing found at all. Then "Baby Spinach" style: Baby carrots
  //    outscores the yogurt row but only hit the side word, so it must
  //    not win over a product that hit the food word.
  {
    const empty = consensus(foodKeeper, [], [], bought);
    const sideWord = consensus(foodKeeper, [match(491, 9, false), match(33, 6)], [match(491, 9, false)], bought);
    check("no credible match", empty, [
      ["empty lists -> no_match", empty.resolution === "no_match"],
      ["UI message set", empty.message === NO_SUGGESTION_MESSAGE],
      ["no product invented", empty.selected === null && empty.range === null],
      ["side-word hit cannot beat a head-word hit", sideWord.selected?.id === 33],
      ["dropped candidate kept for debugging", sideWord.dropped[0]?.product.id === 491],
    ]);
  }

  // 8. The same two rows in both lists, in opposite order.
  {
    const result = consensus(foodKeeper, [match(33, 8), match(29, 5)], [match(29, 5), match(33, 8)], bought);
    const yogurt = result.candidates.find((candidate) => candidate.product.id === 33);
    check("duplicates are merged", result, [
      ["two candidates, not four", result.candidates.length === 2],
      ["keeps index-first rank 1", yogurt?.indexRank === 1],
      ["keeps category-first rank 2", yogurt?.categoryRank === 2],
    ]);
  }

  // 9. Milk's fridge entry is "Package use-by date": no numeric range.
  {
    const tied = consensus(foodKeeper, [match(27, 6), match(33, 6), match(29, 6)], [], bought);
    const alone = consensus(foodKeeper, [match(27, 8)], [match(27, 8)], bought);
    check("missing expiry data", tied, [
      ["not averaged with a non-numeric range", tied.resolution === "no_match"],
      ["says why", tied.reason.includes("no numeric range")],
      ["a lone strong match is still selected", alone.selected?.id === 27],
      ["but with no date", alone.range === null],
    ]);
  }

  // 10. Two tied egg rows, fed in both orders, twice.
  {
    const a = consensus(foodKeeper, [match(21, 6), match(22, 6)], [], bought);
    const b = consensus(foodKeeper, [match(22, 6), match(21, 6)], [], bought);
    const c = consensus(foodKeeper, [match(21, 6), match(22, 6)], [], bought);
    check("deterministic tie-breaking", a, [
      ["same pick whatever the input order", a.selected?.id === b.selected?.id],
      ["same pick on a re-run", a.selected?.id === c.selected?.id],
      ["reported as a tie", a.confidence === "tie"],
    ]);
  }

  // Regression tests for the iteration-2 decision order. Same rows the
  // fixtures produced, rebuilt by hand so each rule is pinned down.
  console.log();

  // 11. Both pick canned goods (high acid) at 5, with three rows at 4
  //     right behind it. Agreement on a credible pick wins; the near
  //     ties lower confidence instead of forcing an abstain.
  {
    const result = consensus(
      foodKeeper,
      [match(373, 5), match(306, 4), match(501, 4), match(647, 4)],
      [match(373, 5), match(501, 4), match(647, 4)],
      bought,
      { categoryHints: [3, 6, 9, 23] },
    );
    check("agreement on a credible pick despite near ties", result, [
      ["resolution consensus", result.resolution === "consensus"],
      ["picks #373", result.selected?.id === 373],
      ["not averaged", result.averagedFrom.length === 0],
      ["confidence lowered, not high", result.confidence === "low"],
    ]);
  }

  // 12. Index-first's raw turkey breast scores 3; category-first's deli
  //     turkey scores 1 and never says "breast". Neither has strong
  //     name evidence, and only the deli row is in the Deli category.
  {
    const result = consensus(
      foodKeeper,
      [match(119, 3), match(120, 3), match(514, 1, false)],
      [match(514, 1, false)],
      bought,
      { categoryHints: [25] },
    );
    check("disagreement decided by category evidence", result, [
      ["resolution reranked", result.resolution === "reranked"],
      ["picks #514", result.selected?.id === 514],
      ["confidence stays low", result.confidence === "low"],
    ]);
  }

  // 13. Both pick fresh fatty fish at score 0, with three smoked-fish
  //     rows tied at 0. A weak agreement does not get a pass: the
  //     tied rows are in other categories, so it abstains.
  {
    const result = consensus(
      foodKeeper,
      [match(146, 0), match(164, 0, false), match(166, 0, false), match(167, 0, false)],
      [match(146, 0), match(164, 0, false), match(166, 0, false), match(167, 0, false)],
      bought,
      { categoryHints: [20, 21, 22] },
    );
    check("weak agreement with incompatible ties abstains", result, [
      ["resolution no_match", result.resolution === "no_match"],
      ["UI message set", result.message === NO_SUGGESTION_MESSAGE],
    ]);
  }

  // 14. Yogurt leads two near-tied dairy rows by 1. Both pick it, so it
  //     is taken; the rows behind it are tied with each other, not
  //     with the winner's evidence, and nothing is averaged.
  {
    const result = consensus(
      foodKeeper,
      [match(33, 8), match(29, 7), match(10, 7)],
      [match(33, 8), match(29, 7), match(10, 7)],
      bought,
      { categoryHints: [7] },
    );
    check("near ties with a credible winner", result, [
      ["picks #33", result.selected?.id === 33],
      ["not averaged", result.resolution !== "averaged"],
    ]);
  }

  // 15. Three fresh vegetables at a weak 3, picked by both. No winner
  //     has real evidence, and the ranges are compatible: averaged.
  //     Asparagus 3-4, broccoli 3-5, cucumbers 4-6 -> 3-5 days.
  {
    const result = consensus(
      foodKeeper,
      [match(271, 3), match(276, 3), match(283, 3)],
      [match(276, 3), match(271, 3), match(283, 3)],
      bought,
      { categoryHints: [18, 19] },
    );
    const range = days(result);
    check("weak compatible near ties are averaged", result, [
      ["resolution averaged", result.resolution === "averaged"],
      ["3-5 days", range?.[0] === 3 && range?.[1] === 5],
    ]);
  }

  // 16. Dry pasta, fresh pasta and rice at a weak 3, picked by both.
  //     Pantry and fridge rows cannot be averaged: abstain.
  {
    const result = consensus(
      foodKeeper,
      [match(335, 3), match(332, 3), match(338, 3)],
      [match(335, 3), match(332, 3), match(338, 3)],
      bought,
      { categoryHints: [3, 6, 9, 23] },
    );
    check("weak incompatible near ties abstain", result, [
      ["resolution no_match", result.resolution === "no_match"],
      ["says storage differs", result.reason.includes("storage")],
    ]);
  }

  // 17. The same five rows in every order of the index list, with a
  //     category list too. Every permutation must pick the same product
  //     the same way. The order of the alternatives may differ, and
  //     should: rank in a list is evidence, so reordering the list
  //     changes it. Identical input must give identical output.
  {
    const rows = [match(119, 3), match(120, 3), match(514, 1, false), match(114, 1, false), match(55, 1)];
    const permutations: Match[][] = [];
    const permute = (left: Match[], done: Match[]) => {
      if (left.length === 0) permutations.push(done);
      left.forEach((row, position) => permute([...left.slice(0, position), ...left.slice(position + 1)], [...done, row]));
    };
    permute(rows, []);
    const outcomes = new Set(
      permutations.map((list) => {
        const result = consensus(foodKeeper, list, [match(514, 1, false)], bought, { categoryHints: [25] });
        return `${result.resolution}|${result.selected?.id}|${result.confidence}`;
      }),
    );
    const run = () => consensus(foodKeeper, rows, [match(514, 1, false)], bought, { categoryHints: [25] });
    const sample = run();
    const fingerprint = (result: ConsensusResult) =>
      `${result.resolution}|${result.selected?.id}|${result.reason}|${result.candidates.map((c) => c.product.id).join(",")}`;
    check(`stable ranking over ${permutations.length} input orders`, sample, [
      ["same pick in every order", outcomes.size === 1],
      ["identical input, identical output", fingerprint(run()) === fingerprint(sample)],
    ]);
  }

  // 18. Ten index-first rows and four category-first rows, two of them
  //     shared. The pool must hold all twelve, credible or dropped.
  {
    const indexIds = [119, 120, 514, 114, 55, 121, 116, 117, 118, 113];
    const categoryIds = [514, 184, 192, 119];
    const result = consensus(
      foodKeeper,
      indexIds.map((id, position) => match(id, 10 - position, id !== 514 && id !== 114)),
      categoryIds.map((id) => match(id, 1, false)),
      bought,
      { categoryHints: [25] },
    );
    const pool = [...result.candidates, ...result.dropped].map((candidate) => candidate.product.id);
    const expected = new Set([...indexIds, ...categoryIds]);
    check("no candidates lost in the merge", result, [
      [`pool has all ${expected.size}`, pool.length === expected.size && pool.every((id) => expected.has(id))],
      ["each listed once", new Set(pool).size === pool.length],
    ]);
  }

  console.log();
  console.log(failures === 0 ? "All targeted tests passed." : `${failures} targeted test(s) failed.`);
  return failures;
}

const foodKeeper = new FoodKeeper(FOODKEEPER_PATH);
runBenchmark(foodKeeper);
if (runTargetedTests(foodKeeper) > 0) process.exitCode = 1;
