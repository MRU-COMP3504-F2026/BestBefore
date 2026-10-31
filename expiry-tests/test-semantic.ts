// Targeted tests for the semantic layer (semantic-expansion.ts and the
// "+semantic" pipeline in strategies.ts). No database, no fixtures.
// Run it from the project root with:
//   npx tsx expiry-tests/test-semantic.ts
//
// Each test checks a behavior on made-up or generic product names,
// not a fixture's expected answer. Prints PASS / FAIL per test and
// exits with code 1 if any fail. The consensus tests in
// test-consensus.ts are separate and unchanged.

import { consensus } from "./consensus.js";
import { CONFIDENT_GAP, MIN_CONFIDENT_SCORE, parseDay, predict } from "./expiry.js";
import { FoodKeeper, type Match } from "./foodkeeper.js";
import { applySemantics, calibrate, expand, type SemanticItem } from "./semantic-expansion.js";
import { FOODKEEPER_PATH, fullSearch, semanticSearch, type FixtureItem } from "./strategies.js";

const foodKeeper = new FoodKeeper(FOODKEEPER_PATH);
const byId = new Map(foodKeeper.products.map((product) => [product.id, product]));
const bought = parseDay("2026-10-31");

// A full fixture-shaped item from just the fields a test cares about.
function item(name: string, fields: Partial<FixtureItem> = {}): FixtureItem {
  return {
    id: 0,
    name,
    brand: null,
    barcode: null,
    category: null,
    quantity: 1,
    unit: null,
    purchaseDate: "2026-10-31",
    bestBefore: "2026-11-30",
    createdAt: "2026-10-31T17:00:00.000Z",
    expectedFoodKeeperId: 0,
    expectedFoodKeeperName: "",
    ...fields,
  };
}

function match(id: number, score: number, extra: Partial<Match> = {}): Match {
  const product = byId.get(id);
  if (!product) throw new Error(`Test setup: FoodKeeper ID ${id} does not exist`);
  return { product, score, headHit: true, ...extra };
}

const ids = (matches: Match[]) => matches.map((entry) => entry.product.id);
const isJuice = (entry: Match) => /juice/i.test(entry.product.name);

let failures = 0;
function check(name: string, expectations: [string, boolean][]) {
  const failed = expectations.filter(([, ok]) => !ok).map(([label]) => label);
  if (failed.length === 0) {
    console.log(`PASS  ${name}`);
    return;
  }
  failures++;
  console.log(`FAIL  ${name}`);
  console.log(`        failed: ${failed.join("; ")}`);
}

console.log("SEMANTIC TESTS");
console.log("=".repeat(85));

// 1. Consumer names land in a broad FoodKeeper family.
{
  const flakes = expand(item("Frosted Flakes"));
  const oats = expand(item("Steel Cut Oats"));
  const porridge = expand(item("Maple Porridge"));
  check("consumer names map to families", [
    ["flakes -> ready-to-eat cereal", flakes.families.includes("ready-to-eat cereal")],
    ["steel cut oats -> hot cereal", oats.families.includes("hot cereal")],
    ["porridge -> hot cereal", porridge.families.includes("hot cereal")],
    ["plain oats stay unexpanded", expand(item("Oats")).families.length === 0],
  ]);
}

// 2. A family term finds a row the item's words never reach.
{
  const sandwich = item("Sandwich Rolls", { category: "Bakery" });
  const plain = ids(fullSearch(foodKeeper, sandwich));
  const semantic = ids(semanticSearch(foodKeeper, sandwich, "index").matches);
  check("synonym expansion adds bread rows", [
    ["family words include bread", expand(sandwich).familyWords.includes("bread")],
    ["a bread row is in the semantic pool", semantic.some((id) => byId.get(id)!.name.toLowerCase().includes("bread"))],
    ["semantic pool is at least as large", semantic.length >= plain.length],
  ]);
}

// 3. One rule covers a whole family of products.
{
  const names = ["Hamburger Buns", "Hot Dog Buns", "Dinner Rolls", "Kaiser Rolls", "Baguette", "Pita"];
  check("several products share the bread family", [
    ...names.map((name): [string, boolean] => [name, expand(item(name)).families.includes("bread")]),
    ["cinnamon toast cereal is not bread", !expand(item("Cinnamon Toast Crunch")).families.includes("bread")],
  ]);
}

// 4. "Frozen" in the name is explicit storage, and frozen rows gain.
{
  const frozen = item("Frozen Raspberries", { category: "Frozen" });
  const result = semanticSearch(foodKeeper, frozen, "index");
  const frozenRows = result.matches.filter((entry) => entry.product.categoryId === 8);
  const storageOnly = (entry: Match) => entry.adjustments?.some((note) => note.includes("only the storage word"));
  const firstStorageOnly = result.matches.findIndex(storageOnly);
  check("explicit frozen storage", [
    ["storage is freezer", result.expansion.storage === "freezer"],
    ["a Food Purchased Frozen row is in the pool", frozenRows.length > 0],
    [
      "frozen rows are credited, or marked as storage-word-only",
      frozenRows.every((entry) => entry.adjustments?.some((note) => note.includes("frozen") || note.includes("storage word"))),
    ],
    [
      "storage-word-only rows rank after all others",
      firstStorageOnly < 0 || result.matches.slice(firstStorageOnly).every(storageOnly),
    ],
  ]);
}

// 5. No storage word and no Frozen category: unknown, and nothing is
//    nudged for storage.
{
  const result = semanticSearch(foodKeeper, item("Raspberries", { category: "Produce" }), "index");
  check("unknown storage changes nothing", [
    ["storage is null", result.expansion.storage === null],
    ["no storage notes", result.matches.every((entry) => !entry.adjustments?.some((note) => note.includes("frozen")))],
  ]);
}

// 6. One row, two storage windows: the match is the same, only the
//    window changes. Yogurt has fridge 1-2 weeks and freezer 1-2 months.
{
  const yogurt = byId.get(33)!;
  const windows = foodKeeper.storageWindows(yogurt);
  const usual = predict(windows, yogurt.categoryId, bought);
  const frozen = predict(windows, yogurt.categoryId, bought, "freezer");
  check("multiple storage durations on one row", [
    ["row has fridge and freezer windows", windows.some((w) => w.key.startsWith("fridge")) && windows.some((w) => w.key.startsWith("freezer"))],
    ["default uses the fridge", usual.kind === "range" && usual.storage === "fridge"],
    ["explicit freezer uses the freezer", frozen.kind === "range" && frozen.storage === "freezer"],
  ]);
}

// 7. Fresh produce does not become juice; juice still finds juice.
{
  const fruit = semanticSearch(foodKeeper, item("Limes", { category: "Produce" }), "index").matches;
  const juice = semanticSearch(foodKeeper, item("Lime Juice", { category: "Beverages" }), "index").matches;
  check("fresh versus processed", [
    ["limes: top row is not a juice", fruit.length > 0 && !isJuice(fruit[0])],
    ["limes: juice rows carry the form note", fruit.filter(isJuice).every((entry) => entry.adjustments?.some((n) => n.startsWith("form")))],
    ["lime juice: top row is a juice", juice.length > 0 && isJuice(juice[0])],
  ]);
}

// 8. Raw item, cooked row: contradiction.
{
  const raw = item("Raw Prawns");
  const result = applySemantics(foodKeeper, raw, expand(raw), [[match(151, 5), match(162, 5)]]);
  const cooked = result.find((entry) => entry.product.id === 162)!;
  check("raw versus cooked", [
    ["cooked row is marked as a contradiction", cooked.contradiction === true],
    ["cooked row ranks below the raw row", ids(result)[0] === 151],
  ]);
}

// 9. Brand present: commercial row over homemade row. No brand: no
//    packaging nudge either way.
{
  const lists = [[match(451, 6), match(452, 6)]];
  const branded = item("Oat Muffins", { brand: "Any Bakery" });
  const unbranded = item("Oat Muffins");
  const withBrand = applySemantics(foodKeeper, branded, expand(branded), lists);
  const without = applySemantics(foodKeeper, unbranded, expand(unbranded), lists);
  check("commercially packaged versus homemade", [
    ["with a brand, the commercial row wins", ids(withBrand)[0] === 452],
    ["with a brand, the homemade row is a contradiction", withBrand.find((e) => e.product.id === 451)!.contradiction === true],
    ["without a brand, no packaging notes", without.every((e) => !e.adjustments?.some((n) => n.includes("brand")))],
  ]);
}

// 10. Nothing stated, nothing inferred.
{
  const plain: SemanticItem = { name: "Hummus", category: "Deli", unit: "g", brand: null, barcode: null };
  const expansion = expand(plain);
  check("missing preparation information", [
    ["no attributes", expansion.attributes.length === 0],
    ["not treated as packaged", expansion.packaged === false],
    ["no storage", expansion.storage === null],
  ]);
}

// 11. Expansion never drops what the plain search found.
{
  const names = ["Greek Yogurt", "Hamburger Buns", "Corn Flakes", "Frozen Blueberries", "Lemons", "Ground Coffee"];
  check("exact-name candidates are preserved", names.map((name): [string, boolean] => {
    const probe = item(name, { category: name.startsWith("Frozen") ? "Frozen" : null, brand: "Brand" });
    const plain = ids(fullSearch(foodKeeper, probe));
    const semantic = new Set(ids(semanticSearch(foodKeeper, probe, "index").matches));
    return [name, plain.every((id) => semantic.has(id))];
  }));
}

// 12. The same row in two lists comes out once, with the higher score.
{
  const probe = item("Test Item");
  const result = applySemantics(foodKeeper, probe, expand(probe), [[match(33, 4)], [match(33, 6, { familyBonus: 2 })]]);
  check("duplicate candidates are merged", [
    ["one entry", result.length === 1],
    ["keeps the higher score", result[0].score === 6],
    ["keeps its family bonus", result[0].familyBonus === 2],
  ]);
}

// 13. Same input, same output.
{
  const probe = item("Dinner Rolls", { category: "Bakery", brand: "Brand" });
  const fingerprint = () =>
    semanticSearch(foodKeeper, probe, "category").matches.map((e) => `${e.product.id}:${e.score}`).join(",");
  check("deterministic scoring", [["two runs agree", fingerprint() === fingerprint()]]);
}

// 14. A lead that only exists because of family words is not "high".
{
  const familyOnly = calibrate("high", { score: 6, familyBonus: 3 }, { score: 2 }, MIN_CONFIDENT_SCORE, CONFIDENT_GAP);
  const ownWords = calibrate("high", { score: 6, familyBonus: 0 }, { score: 2 }, MIN_CONFIDENT_SCORE, CONFIDENT_GAP);
  const contradicts = calibrate("high", { score: 9, contradiction: true }, { score: 2 }, MIN_CONFIDENT_SCORE, CONFIDENT_GAP);
  check("broad matches do not inflate confidence", [
    ["family-only lead -> medium", familyOnly === "medium"],
    ["own-word lead stays high", ownWords === "high"],
    ["contradiction -> low", contradicts === "low"],
    ["low stays low", calibrate("low", { score: 1, familyBonus: 1 }, undefined, MIN_CONFIDENT_SCORE, CONFIDENT_GAP) === "low"],
  ]);
}

// 15. Semantic candidates that disagree on storage still abstain.
{
  const rows = [match(335, 3, { familyBonus: 1 }), match(332, 3, { familyBonus: 1 }), match(338, 3, { familyBonus: 1 })];
  const result = consensus(foodKeeper, rows, rows, bought, { categoryHints: [3, 6, 9, 23] });
  check("incompatible candidates cause abstention", [
    ["no_match", result.resolution === "no_match"],
    ["storage named as the reason", result.reason.includes("storage")],
  ]);
}

// 16. The two consensus regressions from iteration 2 stay fixed when
//     the semantic layer is on.
{
  const run = (probe: FixtureItem) => {
    const index = semanticSearch(foodKeeper, probe, "index").matches;
    const category = semanticSearch(foodKeeper, probe, "category").matches;
    return consensus(foodKeeper, index, category, bought, { categoryHints: probe.category === "Deli" ? [25] : [3, 6, 9, 23] });
  };
  const tomatoes = run(item("Canned Diced Tomatoes", { category: "Pantry", unit: "cans", brand: "Brand" }));
  const turkey = run(item("Sliced Turkey Breast", { category: "Deli", unit: "g", brand: "Brand" }));
  check("existing consensus regression cases", [
    ["canned tomatoes are not abstained", tomatoes.resolution !== "no_match"],
    ["sliced turkey picks a deli row", turkey.selected?.categoryId === 25],
  ]);
}

console.log();
console.log(failures === 0 ? "All semantic tests passed." : `${failures} semantic test(s) failed.`);
if (failures > 0) process.exitCode = 1;
