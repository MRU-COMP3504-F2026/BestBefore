// Mocked tests for the Gemini fallback (ai-fallback.ts). No network:
// every Gemini call goes to a fake client that returns a scripted
// answer and counts how often it was called.
// Run it from the project root with:
//   npx tsx expiry-tests/test-ai-fallback.ts
//
// Prints PASS / FAIL per test, exits with code 1 on any failure.
// These test behavior only. They say nothing about how accurate the
// real model is; test-hybrid.ts --live measures that.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { GeminiError } from "../server/src/food/gemini.js";
import {
  cleanTerms,
  searchMatrix,
  suggestWithFallback,
  type HybridResult,
} from "./ai-fallback.js";
import { NO_SUGGESTION_MESSAGE } from "./consensus.js";
import { parseDay, predict } from "./expiry.js";
import { FoodKeeper } from "./foodkeeper.js";
import { loadAiConfig, type AiClient, type AiConfig } from "./gemini-expiry.js";
import { categoryFirst, FOODKEEPER_PATH, recommendItem, semanticStrategy, type FixtureItem } from "./strategies.js";

const foodKeeper = new FoodKeeper(FOODKEEPER_PATH);

function fixture(set: string): FixtureItem[] {
  const path = fileURLToPath(new URL(`./fixtures/${set}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")).items;
}
const byName = (set: string, name: string) => fixture(set).find((item) => item.name === name)!;

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

const ON: AiConfig = {
  enabled: true,
  tieBreak: true,
  expansion: true,
  model: "mock-model",
  timeoutMs: 1500,
  maxOutputTokens: 256,
  temperature: undefined,
  thinking: "default",
};
const OFF: AiConfig = { ...ON, enabled: false, tieBreak: false, expansion: false };

// A fake Gemini. answer is either the JSON body to return, raw text,
// or an error to throw. calls counts every request.
function mock(answer: unknown | Error | { text: string }) {
  const calls: string[] = [];
  const client: AiClient = async (request) => {
    calls.push(request.mode);
    if (answer instanceof Error) throw answer;
    const text = typeof answer === "object" && answer !== null && "text" in answer ? (answer as { text: string }).text : JSON.stringify(answer);
    return { text, usage: { inputTokens: 120, outputTokens: 20, totalTokens: 140 } };
  };
  return { client, calls };
}

let failures = 0;
function check(name: string, expectations: [string, boolean][], result?: HybridResult) {
  const failed = expectations.filter(([, ok]) => !ok).map(([text]) => text);
  if (failed.length === 0) {
    console.log(`PASS  ${name}`);
    return;
  }
  failures++;
  console.log(`FAIL  ${name}`);
  console.log(`        failed: ${failed.join("; ")}`);
  if (result) {
    console.log(`        got: ${result.resolution}, #${result.selected?.id ?? "none"}, ${result.confidence}, ${result.reason}`);
  }
}

function heading(title: string) {
  console.log();
  console.log(title);
  console.log("=".repeat(85));
}

// Items with known routes. Checked by the tests below, so a change to
// the local engine that moves them shows up as a failure, not silence.
const quickOats = byName("seed-items-2", "Quick Oats"); // tie: 585, 586, 375
const frozenPeas = byName("seed-items-3", "Frozen Peas"); // tie, explicitly frozen
const greekYogurt = byName("seed-items", "Greek Yogurt"); // credible
const cheerios = item("Cheerios", { category: "Pantry", brand: "General Mills", unit: "g" }); // no candidate at all
const CEREAL_TERMS = {
  alternativeNames: ["Ready-to-eat cereal", "Breakfast cereal"],
  alternativeCategories: ["Cereal", "Shelf stable foods"],
};

async function main() {
  heading("TIE RESOLUTION");
  {
    const { client, calls } = mock({ selectedId: 375, reason: "Quick oats are cooked as oatmeal." });
    const result = await suggestWithFallback(foodKeeper, quickOats, { config: ON, client });
    check("valid candidate selection", [
      ["routed as a tie", result.local.route === "tie"],
      ["resolution ai_tie_break", result.resolution === "ai_tie_break"],
      ["picks #375", result.selected?.id === 375],
      ["never high confidence", result.confidence === "medium"],
      ["one request", calls.length === 1],
    ], result);
  }
  {
    const { client } = mock({ selectedId: null, reason: "Not enough information." });
    const result = await suggestWithFallback(foodKeeper, quickOats, { config: ON, client });
    check("Gemini returns null", [
      ["no_match", result.resolution === "no_match"],
      ["UI message", result.message === NO_SUGGESTION_MESSAGE],
      ["no date", result.range === null],
    ], result);
  }
  {
    const { client } = mock({ selectedId: 999, reason: "x" });
    const result = await suggestWithFallback(foodKeeper, quickOats, { config: ON, client });
    check("unknown ID rejected", [["no_match", result.resolution === "no_match"], ["says not on shortlist", result.reason.includes("not on the shortlist")]], result);
  }
  {
    const { client } = mock({ text: "Sure! The answer is 375." });
    const result = await suggestWithFallback(foodKeeper, quickOats, { config: ON, client });
    check("invalid JSON rejected", [["no_match", result.resolution === "no_match"], ["says invalid JSON", result.reason.includes("invalid JSON")]], result);
  }
  {
    // #337 dried split peas has only pantry guidance; the item is frozen.
    const { client } = mock({ selectedId: 337, reason: "Peas." });
    const result = await suggestWithFallback(foodKeeper, frozenPeas, { config: ON, client });
    check("pick contradicting explicit storage is rejected", [
      ["routed as a tie", result.local.route === "tie"],
      ["no_match", result.resolution === "no_match"],
      ["says freezer", result.reason.includes("freezer")],
    ], result);
  }
  {
    const { client, calls } = mock(new GeminiError("timeout"));
    const result = await suggestWithFallback(foodKeeper, quickOats, { config: ON, client });
    check("timeout", [["no_match", result.resolution === "no_match"], ["says timeout", result.reason.includes("timeout")], ["one request, no retry", calls.length === 1]], result);
  }
  {
    const { client, calls } = mock(new GeminiError("upstream", "500"));
    const result = await suggestWithFallback(foodKeeper, quickOats, { config: ON, client });
    check("API error", [["no_match", result.resolution === "no_match"], ["one request", calls.length === 1], ["no expansion after it", result.aiMode === "tie_break"]], result);
  }
  {
    const { client, calls } = mock({ selectedId: 1, reason: "x" });
    const result = await suggestWithFallback(foodKeeper, greekYogurt, { config: ON, client });
    check("no call for a credible local match", [["resolution local", result.resolution === "local"], ["zero requests", calls.length === 0]], result);
  }

  heading("QUERY EXPANSION");
  {
    const { client, calls } = mock(CEREAL_TERMS);
    const result = await suggestWithFallback(foodKeeper, cheerios, { config: ON, client });
    check("valid two-name/two-category response", [
      ["routed as no_match", result.local.route === "no_match"],
      ["resolution ai_query_expansion", result.resolution === "ai_query_expansion"],
      ["one request", calls.length === 1],
    ], result);
    check("expanded candidate discovered", [["ready-to-eat cereal #374 found", result.selected?.id === 374]], result);
    const ids = result.candidates.map((candidate) => candidate.id);
    check("candidate deduplication", [
      ["ids unique", new Set(ids).size === ids.length],
      ["a candidate keeps several sources", result.candidates.some((candidate) => candidate.provenance.length > 1)],
    ], result);
    check("AI matches do not inflate confidence", [
      ["never high", result.confidence !== "high"],
      [
        "score is the best single search, not a sum",
        result.candidates.every((c) => c.score <= Math.max(...c.provenance.map((p) => p.score)) + 3),
      ],
    ], result);
  }
  {
    const pairs = searchMatrix(cheerios, CEREAL_TERMS.alternativeNames, CEREAL_TERMS.alternativeCategories);
    check("nine combinations generated", [["9 pairs", pairs.length === 9]]);
    check("original lookup reused", [
      ["exactly one original pair", pairs.filter((pair) => pair.original).length === 1],
      ["it comes first", pairs[0].original && pairs[0].name === cheerios.name],
    ]);
    const duplicates = searchMatrix(cheerios, ["Cheerios", "Breakfast cereal"], ["pantry", "Cereal"]);
    check("duplicate combinations removed", [["fewer than 9 when terms repeat the original", duplicates.length === 4]]);
  }
  {
    const cleaned = cleanTerms(["", "x", "1234", "a".repeat(80), "Cheerios", "Cereal", " cereal "], "Cheerios");
    check("invalid alternatives rejected", [["only one valid term left", cleaned.length === 1 && cleaned[0] === "Cereal"]]);
    const { client } = mock({ alternativeNames: ["a", "b", "c"], alternativeCategories: ["d"] });
    const result = await suggestWithFallback(foodKeeper, cheerios, { config: ON, client });
    check("wrong-shaped answer rejected", [["no_match", result.resolution === "no_match"]], result);
  }
  {
    // Explicitly frozen (category), no local candidate. AI suggests pasta;
    // anything returned must have freezer guidance.
    const frozenUnknown = item("Zqxw", { category: "Frozen" });
    const { client } = mock({ alternativeNames: ["Pasta", "Dry pasta"], alternativeCategories: ["Grains", "Pasta"] });
    const result = await suggestWithFallback(foodKeeper, frozenUnknown, { config: ON, client });
    const ok = result.candidates.every((candidate) => {
      const product = foodKeeper.products.find((p) => p.id === candidate.id)!;
      return product.categoryId === 8 || foodKeeper.storageWindows(product).some((w) => w.key.startsWith("freezer"));
    });
    check("original product constraints preserved", [["every candidate has freezer guidance", ok], ["dry pasta (pantry only) not picked", result.selected?.id !== 335]], result);
  }
  {
    const { client } = mock({ alternativeNames: ["Qwerty item", "Zzz thing"], alternativeCategories: ["Qqq", "Zzz"] });
    const result = await suggestWithFallback(foodKeeper, cheerios, { config: ON, client });
    check("no credible result after expansion", [["no_match", result.resolution === "no_match"], ["UI message", result.message === NO_SUGGESTION_MESSAGE]], result);
  }
  {
    const { client, calls } = mock(new GeminiError("rate_limited"));
    const result = await suggestWithFallback(foodKeeper, cheerios, { config: ON, client });
    check("no second request after failure", [["no_match", result.resolution === "no_match"], ["exactly one request", calls.length === 1]], result);
  }

  heading("ITERATION 2 REGRESSIONS");
  {
    // A brand name with no FoodKeeper head word and only a weak local
    // match goes to expansion instead of returning the weak match.
    const brand = item("Pop-Tarts", { category: "Pantry", brand: "Kellogg's", unit: "pastries" });
    const { client, calls } = mock({
      alternativeNames: ["Toaster pastries", "Breakfast pastries"],
      alternativeCategories: ["Shelf stable foods", "Baked goods"],
    });
    const result = await suggestWithFallback(foodKeeper, brand, { config: ON, client });
    const offResult = await suggestWithFallback(foodKeeper, brand, { config: OFF });
    check("weak headless match routes to expansion", [
      ["routed as no_match", result.local.route === "no_match"],
      ["one request", calls.length === 1],
      ["toaster pastries #399", result.selected?.id === 399],
      ["no baking soda from pop -> soda", offResult.selected?.id !== 213],
    ], result);
  }
  {
    // The AI says powder; liquid milk must not win.
    const powder = item("Qzv Mix", { category: "Beverages", brand: "Brand" });
    const { client } = mock({
      alternativeNames: ["Chocolate milk powder", "Flavored milk beverage"],
      alternativeCategories: ["Beverages", "Dairy beverages"],
    });
    const result = await suggestWithFallback(foodKeeper, powder, { config: ON, client });
    check("AI-stated form is enforced", [["not liquid milk #27", result.selected?.id !== 27]], result);
  }
  {
    const { client } = mock(CEREAL_TERMS);
    const result = await suggestWithFallback(foodKeeper, cheerios, { config: ON, client });
    check("expansion results are always low confidence", [["low", result.confidence === "low"]], result);
  }

  heading("INTEGRATION");
  {
    const { client, calls } = mock({});
    const result = await suggestWithFallback(foodKeeper, greekYogurt, { config: ON, client });
    check("local match without AI", [["local", result.resolution === "local"], ["no AI used", !result.aiUsed && calls.length === 0]], result);
  }
  {
    const { client } = mock({ selectedId: 375, reason: "Oatmeal." });
    const result = await suggestWithFallback(foodKeeper, quickOats, { config: ON, client });
    const product = foodKeeper.products.find((p) => p.id === 375)!;
    const expected = predict(foodKeeper.storageWindows(product), product.categoryId, parseDay(quickOats.purchaseDate));
    check("ambiguous tie resolved by AI", [["ai_tie_break", result.resolution === "ai_tie_break"]], result);
    check("expiry range comes from the FoodKeeper row", [
      [
        "range matches predict() for #375",
        expected.kind === "range" && result.range?.label === expected.label,
      ],
    ], result);
  }
  {
    const { client } = mock(CEREAL_TERMS);
    const result = await suggestWithFallback(foodKeeper, cheerios, { config: ON, client });
    check("no-match recovered through expansion", [["ai_query_expansion", result.resolution === "ai_query_expansion"], ["has a range", result.range !== null]], result);
  }
  {
    const { client } = mock(new GeminiError("not_configured"));
    const result = await suggestWithFallback(foodKeeper, cheerios, { config: ON, client });
    const noKey = loadAiConfig({});
    check("AI unavailable -> manual entry", [
      ["no_match with the UI message", result.resolution === "no_match" && result.message === NO_SUGGESTION_MESSAGE],
      ["no key -> fallback disabled", !noKey.enabled && !noKey.tieBreak && !noKey.expansion],
      ["production -> expansion off by default", !loadAiConfig({ GEMINI_API_KEY: "k", VERCEL_ENV: "production" }).expansion],
      ["development -> expansion on by default", loadAiConfig({ GEMINI_API_KEY: "k" }).expansion],
      ["tie-break can be switched off alone", !loadAiConfig({ GEMINI_API_KEY: "k", EXPIRY_AI_TIE_BREAK_ENABLED: "false" }).tieBreak],
      ["model falls back to GEMINI_MODEL", loadAiConfig({ GEMINI_API_KEY: "k", GEMINI_MODEL: "m" }).model === "m"],
    ], result);
  }
  {
    // Every fixture item, AI off: the pick is exactly the local engine's.
    const local = semanticStrategy(categoryFirst);
    const items = ["seed-items", "seed-items-2", "seed-items-3"].flatMap(fixture);
    let same = 0;
    for (const probe of items) {
      const result = await suggestWithFallback(foodKeeper, probe, { config: OFF });
      if (result.selected?.id === recommendItem(foodKeeper, local, probe).result?.matches[0]?.product.id) same++;
    }
    check(`AI disabled: deterministic picks unchanged (${items.length} items)`, [["all identical", same === items.length]]);
  }
  {
    const items = ["seed-items", "seed-items-2", "seed-items-3"].flatMap(fixture);
    let worst = 0;
    for (const probe of items) {
      const { client, calls } = mock({ selectedId: null, reason: "x", alternativeNames: [], alternativeCategories: [] });
      await suggestWithFallback(foodKeeper, probe, { config: ON, client });
      worst = Math.max(worst, calls.length);
    }
    check("maximum one AI request per product", [["no lookup made more than one", worst <= 1]]);
  }
  {
    const { client, calls } = mock({ selectedId: 375, reason: "x" });
    const result = await suggestWithFallback(foodKeeper, quickOats, { config: ON, client, userBestBefore: "2026-12-01" });
    check("user-entered date never overwritten", [["date kept", result.userBestBefore === "2026-12-01"], ["no AI spent", calls.length === 0]], result);
  }
  {
    const cache = new Map<string, unknown>();
    const first = mock({ selectedId: 375, reason: "x" });
    await suggestWithFallback(foodKeeper, quickOats, { config: ON, client: first.client, cache });
    const second = mock({ selectedId: 585, reason: "x" });
    const result = await suggestWithFallback(foodKeeper, quickOats, { config: ON, client: second.client, cache });
    check("successful answers are cached", [["second lookup makes no request", second.calls.length === 0], ["reuses the cached pick", result.selected?.id === 375 && result.diagnostics.cached]], result);
  }

  console.log();
  console.log(failures === 0 ? "All AI fallback tests passed." : `${failures} AI fallback test(s) failed.`);
  if (failures > 0) process.exitCode = 1;
}

main();
