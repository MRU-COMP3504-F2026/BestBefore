// Compares the strategy runs. Run the tests first, then:
//   npx tsx expiry-tests/compare-results.ts [--fixture seed-items-2]
//
// Reads results/index-first.json and results/category-first.json, and
// results/consensus.json when it exists. Without the consensus file it
// prints only the two-way sections, exactly as before.
//
// Sections:
//   SUMMARY            the headline numbers side by side
//   DISAGREE           items where index-first and category-first
//                      picked different products, and which was right
//   ONLY CONSENSUS     items only consensus got right
//   CONSENSUS BROKE    items consensus got wrong that an existing
//                      strategy got right
//   ABSTAINED          items where consensus chose to give no
//                      suggestion, and why
//   AVERAGED           items where consensus averaged expiry ranges
//   ALL WRONG          items no strategy got right, which is where
//                      scoring needs work rather than a strategy change
//   TIMING             steady-state time for each
//
// It only reads the files. If they were run against different fixtures
// (a different item count), it says so and stops, because lining up
// results by item id would be meaningless.

import { existsSync, readFileSync } from "node:fs";
import { FIXTURE_NAME, RESULTS_DIR, type ItemResult, type RunFile } from "./strategies.js";

// Same --fixture argument as the tests, so a run on seed-items-2 is
// compared with the other runs on seed-items-2.
function resultsPath(name: string): string {
  return `${RESULTS_DIR}${name}.json`;
}

function load(name: string): RunFile {
  const path = resultsPath(name);
  try {
    return JSON.parse(readFileSync(path, "utf8")) as RunFile;
  } catch {
    const flag = FIXTURE_NAME === "seed-items" ? "" : ` --fixture ${FIXTURE_NAME}`;
    throw new Error(`Could not read ${path}. Run expiry-tests/test-${name}.ts${flag} first.`);
  }
}

function printHeading(title: string) {
  console.log();
  console.log(title);
  console.log("=".repeat(85));
}

function pickText(result: ItemResult): string {
  return result.pick ? `#${result.pick.id} ${result.pick.name}` : "no suggestion";
}

function main() {
  const index = load("index-first");
  const category = load("category-first");
  const consensus = existsSync(resultsPath("consensus")) ? load("consensus") : null;
  const runs = consensus ? [index, category, consensus] : [index, category];

  if (new Set(runs.map((run) => run.results.length)).size > 1) {
    console.log(
      `The runs cover different fixtures (${runs.map((run) => `${run.strategy} ${run.results.length}`).join(", ")} items). ` +
        "Re-run the tests.",
    );
    process.exitCode = 1;
    return;
  }

  const byId = (run: RunFile) => new Map(run.results.map((result) => [result.id, result]));
  const categoryById = byId(category);
  const consensusById = consensus ? byId(consensus) : null;

  // One row per fixture item, the same item in every run.
  const rows = index.results.map((a) => ({
    index: a,
    category: categoryById.get(a.id)!,
    consensus: consensusById?.get(a.id) ?? null,
  }));

  console.log(`Fixture set: ${FIXTURE_NAME}`);
  printHeading("SUMMARY");
  // "Averaged", retrieval and pool recall only exist for consensus, so
  // the other two show "-". Precision and coverage are worked out from
  // noMatch for every run, so all three are on the same definition.
  const suggested = (run: RunFile) => run.summary.items - run.summary.noMatch;
  const pct = (part: number, whole: number) => (whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10);
  const optional = (value: number | undefined, run: RunFile) =>
    value === undefined ? "-" : `${value}/${run.summary.items}`;
  const metrics: [string, (run: RunFile) => string][] = [
    ["Accuracy", (run) => `${run.summary.correct}/${run.summary.items} (${run.summary.accuracy}%)`],
    [
      "Suggestion precision",
      (run) => `${run.summary.correct}/${suggested(run)} (${pct(run.summary.correct, suggested(run))}%)`,
    ],
    ["Coverage", (run) => `${suggested(run)}/${run.summary.items} (${pct(suggested(run), run.summary.items)}%)`],
    ["Retrieval top 3", (run) => optional(run.summary.retrievalTop3, run)],
    ["Pool recall", (run) => optional(run.summary.poolRecall, run)],
    ["Final top 3", (run) => `${run.summary.inTop3}/${run.summary.items} (${run.summary.top3Accuracy}%)`],
    ["High-conf. precision", (run) => `${run.summary.highConfidenceCorrect}/${run.summary.highConfidence}`],
    ["High-conf. coverage", (run) => `${run.summary.highConfidence}/${run.summary.items}`],
    ["Medium conf.", (run) => String(run.results.filter((result) => result.confidence === "medium").length)],
    ["No match", (run) => String(run.summary.noMatch)],
    ["Averaged", (run) => (run.summary.averaged === undefined ? "-" : String(run.summary.averaged))],
    ["Avg latency", (run) => `${run.summary.steadySearchMicros} µs`],
  ];
  const printTable = (table: RunFile[]) => {
    console.log(`${"".padEnd(22)}${table.map((run) => run.strategy.padEnd(26)).join("")}`);
    for (const [label, value] of metrics) {
      console.log(`${label.padEnd(22)}${table.map((run) => value(run).padEnd(26)).join("")}`);
    }
  };
  printTable(runs);

  // The "+semantic" runs, when they exist for this fixture set. Each is
  // compared with its own plain run below.
  const semanticRuns = runs
    .map((run) => `${run.strategy}+semantic`)
    .filter((name) => existsSync(resultsPath(name)))
    .map(load);
  if (semanticRuns.length > 0) {
    printHeading("SUMMARY  (+semantic)");
    printTable(semanticRuns);
  }

  const disagree = rows.filter((row) => row.index.pick?.id !== row.category.pick?.id);

  printHeading(`DISAGREE  (index-first vs category-first, ${disagree.length} items)`);
  if (disagree.length === 0) console.log("Both strategies picked the same product for every item.");
  for (const { index: a, category: b } of disagree) {
    const winner = a.correct ? "index-first right" : b.correct ? "category-first right" : "neither right";
    console.log(`${a.name}  [${a.category ?? "no category"}]  ${winner}`);
    console.log(`  index-first     ${pickText(a)}${a.correct ? "  <- correct" : ""}`);
    console.log(`  category-first  ${pickText(b)}${b.correct ? "  <- correct" : ""}${b.usedFallback ? "  [fallback]" : ""}`);
    if (!a.correct && !b.correct) console.log(`  wanted          #${a.expectedId} ${a.expectedName}`);
  }

  if (consensus) {
    const withConsensus = rows as { index: ItemResult; category: ItemResult; consensus: ItemResult }[];

    const onlyConsensus = withConsensus.filter((row) => row.consensus.correct && !row.index.correct && !row.category.correct);
    printHeading(`ONLY CONSENSUS  (${onlyConsensus.length} items)`);
    if (onlyConsensus.length === 0) console.log("Consensus did not get anything right that both others missed.");
    for (const row of onlyConsensus) console.log(`${row.index.name}  -> ${pickText(row.consensus)}`);

    const broke = withConsensus.filter((row) => !row.consensus.correct && (row.index.correct || row.category.correct));
    printHeading(`CONSENSUS BROKE  (${broke.length} items)`);
    if (broke.length === 0) console.log("Consensus kept every item an existing strategy got right.");
    for (const row of broke) {
      const who = [row.index.correct && "index-first", row.category.correct && "category-first"].filter(Boolean).join(" and ");
      console.log(`${row.index.name}  (${who} had #${row.index.expectedId} ${row.index.expectedName})`);
      console.log(`  consensus  ${pickText(row.consensus)}  [${row.consensus.resolution}]  ${row.consensus.confidenceReason}`);
    }

    const abstained = withConsensus.filter((row) => row.consensus.resolution === "no_match");
    printHeading(`ABSTAINED  (${abstained.length} items)`);
    if (abstained.length === 0) console.log("Consensus gave a suggestion for every item.");
    for (const row of abstained) console.log(`${row.index.name}  ${row.consensus.confidenceReason}`);

    const averaged = withConsensus.filter((row) => row.consensus.resolution === "averaged");
    printHeading(`AVERAGED  (${averaged.length} items)`);
    if (averaged.length === 0) console.log("No fixture item was resolved by averaging.");
    for (const row of averaged) {
      console.log(`${row.index.name}  -> ${row.consensus.predicted}`);
      for (const source of row.consensus.averagedFrom ?? []) console.log(`  from #${source.id}  ${source.range}`);
    }
  }

  const allWrong = rows.filter(
    (row) => !row.index.correct && !row.category.correct && !(row.consensus?.correct ?? false),
  );
  printHeading(`ALL WRONG  (${allWrong.length} items)`);
  if (allWrong.length === 0) console.log("Every item was right in at least one strategy.");
  for (const row of allWrong) {
    const top3 = [row.index, row.category, row.consensus].some((result) => result?.inTop3)
      ? "in a top 3"
      : "not in any top 3";
    console.log(`${row.index.name}  wanted #${row.index.expectedId} ${row.index.expectedName}  (${top3})`);
    console.log(`  index-first     ${pickText(row.index)}`);
    if (row.category.pick?.id !== row.index.pick?.id) console.log(`  category-first  ${pickText(row.category)}`);
    if (row.consensus && row.consensus.pick?.id !== row.index.pick?.id) {
      console.log(`  consensus       ${pickText(row.consensus)}`);
    }
  }

  for (const semantic of semanticRuns) {
    const plain = runs.find((run) => `${run.strategy}+semantic` === semantic.strategy)!;
    const plainById = byId(plain);
    const pairs = semantic.results.map((after) => ({ before: plainById.get(after.id)!, after }));
    const names = (list: typeof pairs) => (list.length ? list.map(({ after }) => after.name).join(", ") : "none");

    printHeading(`SEMANTIC VS PLAIN  (${semantic.strategy})`);
    const fixed = pairs.filter(({ before, after }) => after.correct && !before.correct);
    const broke = pairs.filter(({ before, after }) => !after.correct && before.correct);
    const entered = pairs.filter(({ before, after }) => after.inPool && before.inPool === false);
    console.log(`Fixed (${fixed.length}):  ${names(fixed)}`);
    console.log(`Broke (${broke.length}):  ${names(broke)}`);
    console.log(`Right row entered the pool for the first time (${entered.length}):  ${names(entered)}`);
    for (const [label, flag] of [
      ["Families changed the pick", "familiesChangedPick"],
      ["Storage changed the pick", "storageChangedPick"],
      ["Attributes changed the pick", "attributesChangedPick"],
    ] as const) {
      const changed = pairs.filter(({ after }) => after[flag]);
      console.log(`${label} (${changed.length}):  ${names(changed)}`);
    }
    const unresolved = pairs.filter(({ after }) => !after.correct);
    console.log(`Still wrong (${unresolved.length}):`);
    for (const { after } of unresolved) {
      console.log(`  ${after.name}  -> ${pickText(after)}  [${after.confidence ?? "none"}]  wanted #${after.expectedId} ${after.expectedName}`);
    }
  }

  printHeading("TIMING");
  for (const run of [...runs, ...semanticRuns]) console.log(`${run.strategy.padEnd(16)}${run.summary.steadySearchMicros} µs steady avg`);
  console.log("Category-first runs a second, full search whenever it falls back, so its average includes those.");
  if (consensus) console.log("Consensus runs both searches plus each one's own recommendation, so it costs the most.");
}

main();
