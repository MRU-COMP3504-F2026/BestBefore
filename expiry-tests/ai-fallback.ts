// Two-way Gemini fallback around the deterministic engine.
// Not meant to be run on its own. test-ai-fallback.ts tests it with a
// mocked client; test-hybrid.ts benchmarks it, live only on request.
//
// The local engine is category-first with the semantic layer, the
// strategy the benchmarks recommend. It always runs first. Then:
//   A. credible local match         -> return it, no AI call
//   B. near-tied credible candidates -> one tie_break call: Gemini picks
//                                      one of the shortlisted IDs, or null
//   C. no credible candidate        -> one query_expansion call: Gemini
//                                      returns 2 alternative names and 2
//                                      alternative categories, and the
//                                      local engine searches the 3x3 grid
//   D. AI off, failed, or unhelpful -> no suggestion
// At most one Gemini request per lookup: each route makes one call, a
// failure is final, and B never falls through to C.
//
// Gemini never produces a date. Every range comes from the chosen
// FoodKeeper row through predict() in expiry.ts. Nothing here writes to
// inventory, and a date the user entered is never replaced.

import {
  MIN_CONFIDENT_SCORE,
  categoryHints,
  formatDay,
  parseDay,
  predict,
  predictionKey,
  unitWords,
  type Confidence,
  type Prediction,
} from "./expiry.js";
import { tokenize, type FoodKeeper, type Match } from "./foodkeeper.js";
import {
  EXPANSION_SCHEMA,
  PROMPT_VERSION,
  TIE_BREAK_SCHEMA,
  type AiClient,
  type AiConfig,
  type AiMode,
  type AiUsage,
} from "./gemini-expiry.js";
import { NEAR_TIE_MARGIN, NO_SUGGESTION_MESSAGE } from "./consensus.js";
import { applySemantics, expand, FORM_WORDS, type SemanticExpansion } from "./semantic-expansion.js";
import { categoryFirst, recommendItem, semanticStrategy, type FixtureItem } from "./strategies.js";
import { z } from "zod";

const LOCAL_STRATEGY = semanticStrategy(categoryFirst);
// Same size as the semantic layer's form penalty.
const AI_FORM_PENALTY = 2;
const SHORTLIST_LIMIT = 5;
const SEARCH_LIMIT = 10;
const FROZEN_CATEGORY = 8;

export type Resolution = "local" | "ai_tie_break" | "ai_query_expansion" | "no_match";
export type Route = "credible" | "tie" | "no_match";

export type Provenance = { name: string; category: string | null; ai: boolean; score: number };

export type HybridCandidate = {
  id: number;
  name: string;
  score: number;
  provenance: Provenance[];
};

export type Diagnostics = {
  mode: AiMode | null;
  model: string | null;
  usage: AiUsage | null;
  apiLatencyMs: number | null;
  localLatencyMs: number;
  totalLatencyMs: number;
  cached: boolean;
  accepted: boolean;
  finalId: number | null;
  failure: string | null;
};

export type HybridResult = {
  resolution: Resolution;
  selected: { id: number; name: string } | null;
  range: { earliest: string; latest: string; storage: string; label: string } | null;
  confidence: Confidence | null;
  aiUsed: boolean;
  aiMode: AiMode | null;
  local: { route: Route; pickId: number | null; confidence: Confidence | null; reason: string };
  candidates: HybridCandidate[];
  reason: string;
  // Always true: the suggestion is shown for the user to confirm.
  needsConfirmation: true;
  // The date the user typed, untouched. The engine never sets it.
  userBestBefore: string | null;
  message?: string;
  // Development only; never sent to the frontend.
  diagnostics: Diagnostics;
};

export type FallbackDeps = {
  config: AiConfig;
  client?: AiClient;
  cache?: Map<string, unknown>;
  userBestBefore?: string | null;
};

const tieAnswer = z.object({ selectedId: z.number().int().nullable(), reason: z.string().max(400) }).strict();
const expansionAnswer = z
  .object({
    alternativeNames: z.array(z.string()).length(2),
    alternativeCategories: z.array(z.string()).length(2),
  })
  .strict();

function label(match: Pick<Match, "product">): string {
  const { product } = match;
  return product.subtitle ? `${product.name} (${product.subtitle})` : product.name;
}

function rangeOf(prediction: Prediction) {
  if (prediction.kind !== "range") return null;
  return {
    earliest: formatDay(prediction.earliest),
    latest: formatDay(prediction.latest),
    storage: prediction.storage,
    label: prediction.label,
  };
}

// Same credibility rule as consensus.ts step 2: the item's head word,
// or the item's category, or no candidate had the head word at all.
// No score floor, for the same reason as there: the penalties push
// right answers to 0 or below ("Ketchup, cocktail, or chili sauce").
function credibility(item: FixtureItem, pool: Match[]) {
  const hints = new Set(categoryHints(item.category));
  const anyHead = pool.some((match) => match.headHit);
  return (match: Match) => match.headHit || hints.has(match.product.categoryId) || !anyHead;
}

// A candidate may be accepted from AI help only if it does not clash
// with what the item states: no semantic contradiction, and, for an
// explicitly frozen item, a row that has freezer guidance.
function violation(foodKeeper: FoodKeeper, match: Match, expansion: SemanticExpansion): string | null {
  if (match.contradiction) return "contradicts the item's stated preparation or packaging";
  if (expansion.storage === "freezer") {
    const hasFreezer = foodKeeper.storageWindows(match.product).some((window) => window.key.startsWith("freezer"));
    if (!hasFreezer && match.product.categoryId !== FROZEN_CATEGORY) return "item is frozen, row has no freezer guidance";
  }
  return null;
}

// Free-text category -> FoodKeeper category IDs. Our own category names
// use CATEGORY_HINTS; anything else (an AI alternative like "Breakfast
// cereal") matches FoodKeeper categories that share a word.
export function hintsForCategory(foodKeeper: FoodKeeper, category: string | null): number[] {
  const known = categoryHints(category);
  if (known.length > 0 || !category) return known;
  const words = new Set(tokenize(category));
  return [...foodKeeper.categories.values()]
    .filter((entry) => tokenize(`${entry.name} ${entry.subcategory ?? ""}`).some((word) => words.has(word)))
    .map((entry) => entry.id);
}

function productJson(item: FixtureItem, expansion: SemanticExpansion) {
  return {
    name: item.name,
    category: item.category,
    ...(item.brand ? { brand: item.brand } : {}),
    ...(expansion.storage ? { storage: expansion.storage } : {}),
    ...(expansion.attributes.length ? { attributes: expansion.attributes } : {}),
  };
}

export function tieBreakPrompt(item: FixtureItem, expansion: SemanticExpansion, shortlist: Match[], foodKeeper: FoodKeeper): string {
  const input = {
    mode: "tie_break",
    product: productJson(item, expansion),
    candidates: shortlist.map((match) => ({
      id: match.product.id,
      name: label(match),
      category: foodKeeper.categoryLabel(match.product.categoryId),
      storage: [...new Set(foodKeeper.storageWindows(match.product).map((w) => w.key.replace(/(Dop|Opened|Thawed)$/, "")))],
    })),
  };
  return [
    "You classify a grocery product into one row of the USDA FoodKeeper storage dataset.",
    "Pick the candidate that is the same kind of food as the product. Judge product identity, not word overlap.",
    "Use the category and any stated storage or preparation. Do not assume facts the product does not state.",
    "selectedId must be one of the candidate ids, or null if the candidates cannot be told apart from the information given.",
    "Never give a date or a duration. Keep reason under 20 words.",
    JSON.stringify(input),
  ].join("\n");
}

export function expansionPrompt(item: FixtureItem, expansion: SemanticExpansion): string {
  return [
    "FoodKeeper is a USDA food-storage dataset that files foods under broad names such as",
    '"Cereal (ready-to-eat)", "Commercial bread products", or "Fruits (frozen)".',
    "For the product below, give exactly 2 alternative names and exactly 2 alternative categories",
    "that such a dataset would likely use. Prefer broad food families over brand names or close synonyms.",
    "If the name is a brand, say what kind of product it is (for example a brand of soy sauce -> \"Soy sauce\").",
    "Do not add a storage state, preparation, packaging, or processing the product does not state.",
    JSON.stringify({ mode: "query_expansion", product: productJson(item, expansion) }),
  ].join("\n");
}

// Trimmed, single-spaced, 2-60 characters, with letters, and not the
// original. Duplicates (case-insensitive) collapse.
export function cleanTerms(terms: string[], original: string | null): string[] {
  const seen = new Set([original?.trim().toLowerCase() ?? ""]);
  const result: string[] = [];
  for (const term of terms) {
    const clean = term.replace(/\s+/g, " ").trim();
    const key = clean.toLowerCase();
    if (clean.length < 2 || clean.length > 60 || !/[a-z]/i.test(clean) || seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
  }
  return result;
}

// The 3x3 grid of (name, category) searches, duplicates removed. The
// original pair is listed first and flagged so its lookup is reused.
export function searchMatrix(item: FixtureItem, names: string[], categories: string[]) {
  const pairs: { name: string; category: string | null; ai: boolean; original: boolean }[] = [];
  const seen = new Set<string>();
  for (const name of [item.name, ...names]) {
    for (const category of [item.category, ...categories]) {
      const key = `${name.toLowerCase()}|${(category ?? "").toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const original = name === item.name && category === item.category;
      pairs.push({ name, category, ai: !original, original });
    }
  }
  return pairs;
}

function cacheKey(config: AiConfig, mode: AiMode, item: FixtureItem, expansion: SemanticExpansion, ids: number[] = []) {
  return JSON.stringify([
    PROMPT_VERSION,
    config.model,
    mode,
    item.name.trim().toLowerCase(),
    item.category,
    item.brand ? "branded" : "unbranded",
    expansion.storage,
    expansion.attributes,
    ids,
  ]);
}

export async function suggestWithFallback(
  foodKeeper: FoodKeeper,
  item: FixtureItem,
  deps: FallbackDeps,
): Promise<HybridResult> {
  const started = performance.now();
  const bought = parseDay(item.purchaseDate);
  const expansion = expand(item);
  const storage = expansion.storage ?? undefined;

  const local = recommendItem(foodKeeper, LOCAL_STRATEGY, item);
  const localLatencyMs = performance.now() - started;
  const pool = local.matches;
  const rec = local.result;
  const isCredible = credibility(item, pool);
  const pick = rec?.matches[0];

  // Routing, from the local engine's own metadata.
  // "No candidate has the head word" makes every candidate credible
  // (FoodKeeper never says "fillets"), but brand names have no head word
  // in FoodKeeper either ("Pop-Tarts", "Fruit Roll-Ups"). There, only a
  // strong score counts as a real match; a weak one is no match at all.
  const headless = !pool.some((match) => match.headHit);
  let route: Route;
  let shortlist: Match[] = [];
  if (!rec || !pick || !isCredible(pick) || (headless && pick.score < MIN_CONFIDENT_SCORE)) {
    route = "no_match";
  } else {
    shortlist = pool
      .filter((match) => isCredible(match) && match.score >= pick.score - NEAR_TIE_MARGIN)
      .slice(0, SHORTLIST_LIMIT);
    const datesFor = (match: Match) =>
      predictionKey(predict(foodKeeper.storageWindows(match.product), match.product.categoryId, bought, storage));
    const sameDates = shortlist.every((match) => datesFor(match) === datesFor(pick));
    const unresolved = rec.confidence === "tie" || rec.confidence === "low";
    route = shortlist.length >= 2 && !sameDates && unresolved ? "tie" : "credible";
  }

  const localSummary = {
    route,
    pickId: pick?.product.id ?? null,
    confidence: rec?.confidence ?? null,
    reason: rec?.reason ?? "no candidate",
  };
  const toCandidate = (match: Match, provenance: Provenance[]): HybridCandidate => ({
    id: match.product.id,
    name: label(match),
    score: match.score,
    provenance,
  });
  const localProvenance = (match: Match): Provenance[] => [
    { name: item.name, category: item.category, ai: false, score: match.score },
  ];

  const diagnostics: Diagnostics = {
    mode: null,
    model: null,
    usage: null,
    apiLatencyMs: null,
    localLatencyMs,
    totalLatencyMs: 0,
    cached: false,
    accepted: false,
    finalId: null,
    failure: null,
  };
  const finish = (result: Omit<HybridResult, "diagnostics" | "needsConfirmation" | "userBestBefore" | "local">) => {
    diagnostics.totalLatencyMs = performance.now() - started;
    diagnostics.finalId = result.selected?.id ?? null;
    return {
      ...result,
      local: localSummary,
      needsConfirmation: true as const,
      userBestBefore: deps.userBestBefore ?? null,
      diagnostics,
    };
  };
  const noMatch = (reason: string, aiMode: AiMode | null, candidates: HybridCandidate[] = []) => {
    diagnostics.failure = reason;
    return finish({
      resolution: "no_match",
      selected: null,
      range: null,
      confidence: null,
      aiUsed: aiMode !== null,
      aiMode,
      candidates,
      reason,
      message: NO_SUGGESTION_MESSAGE,
    });
  };
  const localResult = () => {
    const prediction = rec!.prediction;
    return finish({
      resolution: "local",
      selected: { id: pick!.product.id, name: label(pick!) },
      range: rangeOf(prediction),
      confidence: rec!.confidence,
      aiUsed: false,
      aiMode: null,
      candidates: rec!.matches.map((match) => toCandidate(match, localProvenance(match))),
      reason: rec!.reason,
    });
  };

  // A typed date wins outright. The local suggestion is still returned
  // for reference, but no AI is spent and nothing is replaced.
  if (deps.userBestBefore) {
    return rec && pick ? localResult() : noMatch("user entered a date; no suggestion needed", null);
  }

  if (route === "credible") return localResult();

  const aiOff = !deps.config.enabled || !deps.client;
  // AI disabled: deterministic behavior is exactly the local engine's.
  if (route === "tie" && (aiOff || !deps.config.tieBreak)) return localResult();
  if (route === "no_match" && (aiOff || !deps.config.expansion)) {
    return rec && pick ? localResult() : noMatch("no local candidate, and AI expansion is off", null);
  }

  const mode: AiMode = route === "tie" ? "tie_break" : "query_expansion";
  diagnostics.mode = mode;
  diagnostics.model = deps.config.model;
  const key = cacheKey(deps.config, mode, item, expansion, shortlist.map((match) => match.product.id));

  // The one Gemini request for this lookup (or a cached answer).
  let raw: unknown;
  const cached = deps.cache?.get(key);
  if (cached !== undefined) {
    raw = cached;
    diagnostics.cached = true;
  } else {
    const prompt =
      mode === "tie_break" ? tieBreakPrompt(item, expansion, shortlist, foodKeeper) : expansionPrompt(item, expansion);
    const apiStart = performance.now();
    try {
      const response = await deps.client!({ mode, prompt, schema: mode === "tie_break" ? TIE_BREAK_SCHEMA : EXPANSION_SCHEMA });
      diagnostics.usage = response.usage;
      raw = JSON.parse(response.text ?? "");
    } catch (err) {
      diagnostics.apiLatencyMs = performance.now() - apiStart;
      const code = err instanceof Error ? err.message : "unknown";
      return noMatch(`AI ${mode} failed (${code === "Unexpected end of JSON input" || err instanceof SyntaxError ? "invalid JSON" : code})`, mode);
    }
    diagnostics.apiLatencyMs = performance.now() - apiStart;
  }

  if (mode === "tie_break") {
    const parsed = tieAnswer.safeParse(raw);
    if (!parsed.success) return noMatch("AI tie_break answer did not match the schema", mode);
    if (parsed.data.selectedId === null) {
      return noMatch(`AI could not separate the candidates: ${parsed.data.reason}`, mode, shortlist.map((m) => toCandidate(m, localProvenance(m))));
    }
    const chosen = shortlist.find((match) => match.product.id === parsed.data.selectedId);
    if (!chosen) return noMatch(`AI picked #${parsed.data.selectedId}, which was not on the shortlist`, mode);
    const problem = violation(foodKeeper, chosen, expansion);
    if (problem) return noMatch(`AI pick #${chosen.product.id} rejected: ${problem}`, mode);

    deps.cache?.set(key, raw);
    diagnostics.accepted = true;
    const prediction = predict(foodKeeper.storageWindows(chosen.product), chosen.product.categoryId, bought, storage);
    return finish({
      resolution: "ai_tie_break",
      selected: { id: chosen.product.id, name: label(chosen) },
      range: rangeOf(prediction),
      // AI evidence is never "high": it is unverified, and the user confirms.
      confidence: "medium",
      aiUsed: true,
      aiMode: mode,
      candidates: [chosen, ...shortlist.filter((m) => m !== chosen)].map((m) => toCandidate(m, localProvenance(m))),
      reason: `AI tie-break: ${parsed.data.reason}`,
    });
  }

  // query_expansion
  const parsed = expansionAnswer.safeParse(raw);
  if (!parsed.success) return noMatch("AI query_expansion answer did not match the schema", mode);
  const names = cleanTerms(parsed.data.alternativeNames, item.name);
  const categories = cleanTerms(parsed.data.alternativeCategories, item.category);
  if (names.length === 0 && categories.length === 0) return noMatch("AI alternatives were all empty or invalid", mode);

  // Every (name, category) pair, the original one reused. Each match
  // keeps the strongest score it reached and where it was found; scores
  // from several AI searches are never added together.
  const provenance = new Map<number, Provenance[]>();
  const lists: Match[][] = [];
  const aiCategoryHints = new Set(categories.flatMap((category) => hintsForCategory(foodKeeper, category)));
  for (const pair of searchMatrix(item, names, categories)) {
    let matches: Match[];
    if (pair.original) {
      matches = pool;
    } else {
      const hints = hintsForCategory(foodKeeper, pair.category);
      const probe = { ...item, name: pair.name, category: pair.category };
      const options = {
        hints,
        extraWords: unitWords(item.unit),
        familyWords: expand(probe).familyWords,
        limit: SEARCH_LIMIT,
      };
      matches = hints.length ? foodKeeper.search(pair.name, { ...options, onlyCategories: new Set(hints) }) : [];
      if (matches.length === 0) matches = foodKeeper.search(pair.name, options);
    }
    lists.push(matches);
    for (const match of matches) {
      const list = provenance.get(match.product.id) ?? [];
      list.push({ name: pair.name, category: pair.category, ai: pair.ai, score: match.score });
      provenance.set(match.product.id, list);
    }
  }

  // Rules from the original item apply to every candidate, however it
  // was found: contradictions, packaging, storage.
  // Forms the AI's own names state ("Chocolate milk powder") are kept
  // as a check: a row in none of those forms loses FORM_PENALTY, so a
  // powder does not land on liquid milk. Only forms the AI named count;
  // nothing is inferred when it named none.
  const aiForms = [...new Set(names.flatMap((name) => tokenize(name)).filter((word) => FORM_WORDS.has(word)))];
  const merged = applySemantics(foodKeeper, item, expansion, lists)
    .map((match) => {
      if (aiForms.length === 0) return match;
      const rowWords = new Set(tokenize(`${match.product.name} ${match.product.subtitle ?? ""}`));
      if (aiForms.some((form) => rowWords.has(form))) return match;
      return {
        ...match,
        score: match.score - AI_FORM_PENALTY,
        adjustments: [...(match.adjustments ?? []), `not in the AI-stated form (${aiForms.join("/")}) -${AI_FORM_PENALTY}`],
      };
    })
    .sort((a, b) => b.score - a.score);
  const originalWords = new Set(tokenize(item.name));
  const originalHints = new Set(categoryHints(item.category));
  const plausible = merged.filter((match) => {
    if (violation(foodKeeper, match, expansion)) return false;
    if (provenance.get(match.product.id)?.some((p) => !p.ai)) return isCredible(match);
    // Found only through AI terms: it must still relate to the original
    // product by a shared word or a category, the original's or an AI one.
    const words = tokenize(`${match.product.name} ${match.product.subtitle ?? ""} ${match.product.keywords ?? ""}`);
    return (
      words.some((word) => originalWords.has(word)) ||
      originalHints.has(match.product.categoryId) ||
      aiCategoryHints.has(match.product.categoryId)
    );
  });
  const candidates = plausible.slice(0, 3).map((match) => toCandidate(match, provenance.get(match.product.id) ?? []));

  const [best, second] = plausible;
  if (!best) return noMatch("expanded searches found nothing plausible for the original product", mode, candidates);
  const predictionFor = (match: Match) =>
    predict(foodKeeper.storageWindows(match.product), match.product.categoryId, bought, storage);
  const bestPrediction = predictionFor(best);
  if (second && second.score >= best.score - NEAR_TIE_MARGIN && predictionKey(predictionFor(second)) !== predictionKey(bestPrediction)) {
    return noMatch("expanded searches are still ambiguous", mode, candidates);
  }

  deps.cache?.set(key, raw);
  diagnostics.accepted = true;
  return finish({
    resolution: "ai_query_expansion",
    selected: { id: best.product.id, name: label(best) },
    range: rangeOf(bestPrediction),
    // Found only through unverified AI search terms, so always low: the
    // user confirms, and a clear score lead over other AI-found rows is
    // no evidence the terms themselves were right.
    confidence: "low",
    aiUsed: true,
    aiMode: mode,
    candidates,
    reason: `found through AI terms (${[...names, ...categories].join("; ")})`,
  });
}
