// Benchmark for the Gemini fallback (ai-fallback.ts) on a fixture set.
// Run it from the project root:
//   npx tsx expiry-tests/test-hybrid.ts [--fixture seed-items-2]
//       Dry run, no API calls. Shows which items would go to Gemini.
//   npx tsx expiry-tests/test-hybrid.ts --live [--max-requests 25] [--probe] [--delay-ms 4500]
//       Calls Gemini for real, at most --max-requests times (default
//       25) including the probe. Needs GEMINI_API_KEY in .env.local.
//       --probe first sends one tiny request per thinking setting until
//       the model accepts one, and uses that for the run.
// Never run by CI: nothing calls it, and it does nothing live without
// --live.
//
// One live pass covers all four modes. Each item takes at most one AI
// route (tie_break or query_expansion, never both), so:
//   deterministic   the local engine alone
//   tie-break       AI answer for tie-routed items, local for the rest
//   expansion       AI answer for no-match items, local for the rest
//   hybrid          both
// Writes results/<fixture>/hybrid.json (no prompts, no key).

import "../server/src/env.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { suggestWithFallback, type HybridResult } from "./ai-fallback.js";
import { FoodKeeper } from "./foodkeeper.js";
import { createGeminiClient, loadAiConfig, TIE_BREAK_SCHEMA, type AiClient, type AiConfig, type ThinkingMode } from "./gemini-expiry.js";
import { FIXTURE_NAME, FOODKEEPER_PATH, loadFixture, RESULTS_DIR, type FixtureItem } from "./strategies.js";

const LIVE = process.argv.includes("--live");
const PROBE = process.argv.includes("--probe");
const maxArg = process.argv.indexOf("--max-requests");
const MAX_REQUESTS = maxArg >= 0 ? Number(process.argv[maxArg + 1]) : 25;
// Pause before each live request, so a run stays under the API's
// requests-per-minute limit (free tiers return 429 past it).
const delayArg = process.argv.indexOf("--delay-ms");
const DELAY_MS = delayArg >= 0 ? Number(process.argv[delayArg + 1]) : 0;

// Assumed list prices, USD per million tokens, for a Flash-Lite model.
// Check current pricing; override with EXPIRY_AI_PRICE_INPUT_PER_M and
// EXPIRY_AI_PRICE_OUTPUT_PER_M. The cost line is an estimate from real
// token counts times these prices.
const PRICE_IN = Number(process.env.EXPIRY_AI_PRICE_INPUT_PER_M ?? 0.1);
const PRICE_OUT = Number(process.env.EXPIRY_AI_PRICE_OUTPUT_PER_M ?? 0.4);

function heading(title: string) {
  console.log();
  console.log(title);
  console.log("=".repeat(85));
}

// Wraps a client with the request cap. Past the cap it returns null,
// and the caller runs that item with AI off.
function capped(client: AiClient) {
  let used = 0;
  return {
    get used() {
      return used;
    },
    // inner defaults to the run's client; the probe passes its own.
    take(inner: AiClient = client): AiClient | undefined {
      if (used >= MAX_REQUESTS) return undefined;
      return async (request) => {
        used++;
        return inner(request);
      };
    },
  };
}

async function probe(config: AiConfig, budget: ReturnType<typeof capped>): Promise<ThinkingMode | null> {
  for (const thinking of ["minimal", "budget0", "default"] as ThinkingMode[]) {
    // Counted against --max-requests like any other call.
    const client = budget.take(createGeminiClient({ ...config, thinking, timeoutMs: 10_000 }));
    if (!client) return null;
    try {
      await client({
        mode: "tie_break",
        prompt: 'Reply with {"selectedId": 1, "reason": "probe"}.',
        schema: TIE_BREAK_SCHEMA,
      });
      console.log(`Probe: thinking "${thinking}" accepted by ${config.model}`);
      return thinking;
    } catch (err) {
      console.log(`Probe: thinking "${thinking}" rejected (${err instanceof Error ? err.message : err})`);
    }
  }
  return null;
}

type Row = { item: FixtureItem; deterministic: HybridResult; hybrid: HybridResult; aiSkipped: boolean };

function metrics(rows: Row[], pick: (row: Row) => HybridResult) {
  const results = rows.map((row) => ({ row, result: pick(row) }));
  const correct = results.filter(({ row, result }) => result.selected?.id === row.item.expectedFoodKeeperId).length;
  const suggested = results.filter(({ result }) => result.selected !== null).length;
  const high = results.filter(({ result }) => result.confidence === "high");
  const highRight = high.filter(({ row, result }) => result.selected?.id === row.item.expectedFoodKeeperId).length;
  const pct = (part: number, whole: number) => (whole === 0 ? "-" : `${Math.round((part / whole) * 1000) / 10}%`);
  return {
    accuracy: `${correct}/${rows.length} (${pct(correct, rows.length)})`,
    precision: `${correct}/${suggested} (${pct(correct, suggested)})`,
    coverage: `${suggested}/${rows.length} (${pct(suggested, rows.length)})`,
    highPrecision: `${highRight}/${high.length}`,
  };
}

async function main() {
  const foodKeeper = new FoodKeeper(FOODKEEPER_PATH);
  const { items } = loadFixture();
  const base = loadAiConfig();
  const config: AiConfig = LIVE ? base : { ...base, enabled: true, tieBreak: true, expansion: true };

  console.log(`Fixture set: ${FIXTURE_NAME}   mode: ${LIVE ? `LIVE (max ${MAX_REQUESTS} requests)` : "dry run, no API calls"}`);
  console.log(`Model: ${config.model}   timeout ${config.timeoutMs} ms   tie-break ${config.tieBreak}   expansion ${config.expansion}`);
  if (LIVE && !base.enabled) {
    console.log("AI fallback is disabled (no GEMINI_API_KEY, or EXPIRY_AI_FALLBACK_ENABLED=false). Nothing to run live.");
    process.exitCode = 1;
    return;
  }

  const budget = capped(LIVE ? createGeminiClient(config) : async () => ({ text: "", usage: { inputTokens: null, outputTokens: null, totalTokens: null } }));
  let runConfig = config;
  if (LIVE && PROBE) {
    const thinking = await probe(config, budget);
    if (thinking === null) {
      console.log("No thinking setting was accepted; stopping.");
      process.exitCode = 1;
      return;
    }
    runConfig = { ...config, thinking };
  }

  const rows: Row[] = [];
  const off: AiConfig = { ...runConfig, enabled: false, tieBreak: false, expansion: false };
  for (const item of items) {
    const deterministic = await suggestWithFallback(foodKeeper, item, { config: off });
    if (!LIVE) {
      rows.push({ item, deterministic, hybrid: deterministic, aiSkipped: deterministic.local.route !== "credible" });
      continue;
    }
    const client = deterministic.local.route === "credible" ? undefined : budget.take();
    // The pause sits outside the lookup, so it is not counted as AI latency.
    if (client && budget.used > 0 && DELAY_MS > 0) await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    const hybrid = client
      ? await suggestWithFallback(foodKeeper, item, { config: runConfig, client })
      : deterministic;
    rows.push({ item, deterministic, hybrid, aiSkipped: !client && deterministic.local.route !== "credible" });
  }

  const routed = rows.filter((row) => row.deterministic.local.route !== "credible");
  heading(`ROUTING  (${routed.length} of ${rows.length} items would use AI)`);
  for (const row of routed) {
    const right = (result: HybridResult) => (result.selected?.id === row.item.expectedFoodKeeperId ? "ok" : "--");
    const local = `${right(row.deterministic)} local #${row.deterministic.selected?.id ?? "none"}`;
    const ai = LIVE && !row.aiSkipped
      ? `${right(row.hybrid)} ${row.hybrid.resolution} #${row.hybrid.selected?.id ?? "none"}  (${row.hybrid.reason.slice(0, 70)})`
      : "not sent";
    console.log(`${row.deterministic.local.route.padEnd(9)} ${row.item.name.padEnd(24)} ${local.padEnd(16)} -> ${ai}`);
  }

  if (!LIVE) {
    console.log();
    console.log("Dry run: nothing was sent. Add --live to call Gemini for the items above.");
    return;
  }

  const tieOnly = (row: Row) => (row.deterministic.local.route === "tie" ? row.hybrid : row.deterministic);
  const expansionOnly = (row: Row) => (row.deterministic.local.route === "no_match" ? row.hybrid : row.deterministic);
  const modes: [string, (row: Row) => HybridResult][] = [
    ["deterministic", (row) => row.deterministic],
    ["tie-break", tieOnly],
    ["expansion", expansionOnly],
    ["hybrid", (row) => row.hybrid],
  ];

  heading("SUMMARY");
  console.log(`${"".padEnd(22)}${modes.map(([name]) => name.padEnd(18)).join("")}`);
  const table = modes.map(([, pick]) => metrics(rows, pick));
  for (const [label, key] of [
    ["Accuracy", "accuracy"],
    ["Suggestion precision", "precision"],
    ["Coverage", "coverage"],
    ["High-conf. precision", "highPrecision"],
  ] as const) {
    console.log(`${label.padEnd(22)}${table.map((entry) => entry[key].padEnd(18)).join("")}`);
  }

  const sent = rows.filter((row) => row.hybrid.aiUsed);
  const fixed = sent.filter((row) => row.hybrid.selected?.id === row.item.expectedFoodKeeperId && row.deterministic.selected?.id !== row.item.expectedFoodKeeperId);
  const broke = sent.filter((row) => row.hybrid.selected?.id !== row.item.expectedFoodKeeperId && row.deterministic.selected?.id === row.item.expectedFoodKeeperId);
  const abstained = sent.filter((row) => row.hybrid.resolution === "no_match");
  const tokens = sent.reduce(
    (sum, row) => {
      const usage = row.hybrid.diagnostics.usage;
      return {
        input: sum.input + (usage?.inputTokens ?? 0),
        output: sum.output + Math.max(0, (usage?.totalTokens ?? 0) - (usage?.inputTokens ?? 0)),
      };
    },
    { input: 0, output: 0 },
  );
  const latencies = sent.map((row) => row.hybrid.diagnostics.apiLatencyMs ?? 0);
  const totals = sent.map((row) => row.hybrid.diagnostics.totalLatencyMs);
  const avg = (values: number[]) => (values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0);

  heading("AI EFFECT");
  console.log(`Fixed by AI (${fixed.length}):  ${fixed.map((row) => row.item.name).join(", ") || "none"}`);
  console.log(`Broken by AI (${broke.length}):  ${broke.map((row) => row.item.name).join(", ") || "none"}`);
  console.log(`AI abstained (${abstained.length}):  ${abstained.map((row) => `${row.item.name} (${row.hybrid.reason})`).join("; ") || "none"}`);
  console.log(`Skipped by request cap: ${rows.filter((row) => row.aiSkipped).length}`);
  console.log(`API requests: ${budget.used}${PROBE ? " (including the probe)" : ""}`);
  console.log(`Tokens (from usage metadata): ${tokens.input} input, ${tokens.output} output (incl. any thinking)`);
  console.log(
    `Estimated cost: $${((tokens.input * PRICE_IN + tokens.output * PRICE_OUT) / 1e6).toFixed(6)} ` +
      `at $${PRICE_IN}/M in, $${PRICE_OUT}/M out (assumed prices)`,
  );
  console.log(`AI latency: avg ${avg(latencies)} ms, max ${Math.round(Math.max(0, ...latencies))} ms`);
  console.log(`End-to-end with AI: avg ${avg(totals)} ms, max ${Math.round(Math.max(0, ...totals))} ms`);

  mkdirSync(RESULTS_DIR, { recursive: true });
  const outPath = `${RESULTS_DIR}hybrid.json`;
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        fixture: FIXTURE_NAME,
        model: runConfig.model,
        thinking: runConfig.thinking,
        ranAt: new Date().toISOString(),
        requests: budget.used,
        tokens,
        summary: Object.fromEntries(modes.map(([name], index) => [name, table[index]])),
        items: rows.map((row) => ({
          id: row.item.id,
          name: row.item.name,
          expectedId: row.item.expectedFoodKeeperId,
          route: row.deterministic.local.route,
          deterministic: row.deterministic.selected?.id ?? null,
          hybrid: row.hybrid.selected?.id ?? null,
          resolution: row.hybrid.resolution,
          confidence: row.hybrid.confidence,
          reason: row.hybrid.reason,
          diagnostics: row.hybrid.diagnostics,
        })),
      },
      null,
      2,
    ) + "\n",
  );
  console.log();
  console.log(`Wrote ${outPath}`);
}

main();
