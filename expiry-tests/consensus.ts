// Dual-search consensus: runs index-first and category-first on the
// same item, merges what they found, and picks one answer, averages a
// few compatible ones, or abstains.
// Not meant to be run on its own. test-consensus.ts runs it.
//
// The two strategies share one scoring function (foodkeeper.ts). The
// only difference is that category-first drops products outside the
// item's categories. So a product found by both has the same score in
// both lists, and scores from the two lists are directly comparable.
// Nothing is normalized or added together. Agreement between the
// lists is used only to order candidates whose scores are equal, never
// to raise a score.
//
// Steps, for one item:
//   1. Run both searches (10 results each) and merge by FoodKeeper ID.
//      Each merged candidate keeps its score and its rank in each list.
//      Nothing is dropped here, so the pool holds every product either
//      search returned.
//   2. Drop candidates that are not credible. A candidate is credible
//      when it hit the item's head word ("yogurt" in "Greek Yogurt"),
//      or it sits in one of the item's categories (CATEGORY_HINTS), or
//      no candidate hit the head word at all (the head is a word
//      FoodKeeper never uses, like "fillets"). So a product that only
//      shared a side word ("baby" in Baby carrots) and is outside the
//      item's category is dropped. A product in the item's category is
//      kept even without the head word: "Sliced Turkey Breast" is right
//      as "Turkey (luncheon/deli meat)", which never says "breast".
//      There is no score floor. The penalties in foodkeeper.ts can push
//      a right answer to 0 ("Ketchup, cocktail, or chili sauce" loses
//      points for three words the item never said).
//   3. Order the credible ones, deterministically, by:
//        score, highest first
//        found by both lists before found by one
//        shorter predicted shelf life first (the existing tiebreak in
//          expiry.ts: erring early is the safe side)
//        rank in the index-first list, then in the category-first list
//        FoodKeeper ID
//   4. Decide, in this order. Each strategy's own pick is what
//      recommend() in expiry.ts would show for its list.
//      A. Both picked the same product and it scores at least
//         MIN_CONFIDENT_SCORE: take it. Nearby alternatives do not
//         trigger averaging or an abstain; they only lower confidence.
//      B. They picked different products: compare the two picks.
//           one leads by CONFIDENT_GAP and scores MIN_CONFIDENT_SCORE
//             -> the name evidence decides, take it
//           otherwise, if only category-first's pick is in the item's
//           category, and it scores at least MIN_CATEGORY_EVIDENCE_SCORE
//             -> the category decides, take it
//           otherwise fall through to C.
//      C. No clear winner (weak agreement, or B undecided). Take the
//         top of the step-3 order, unless 3 or more candidates are
//         within NEAR_TIE_MARGIN of it. Then:
//           all predict the same dates -> take the top anyway
//           ranges are compatible      -> averaged
//           otherwise                  -> no_match (abstain)
//      Confidence, for any pick: high only with a score of at least
//      MIN_CONFIDENT_SCORE and a lead of at least CONFIDENT_GAP over
//      the best other credible candidate, the same thresholds
//      recommend() uses. Agreement and category never raise it.
//
// The result is a suggestion. Nothing here writes to inventory.

import {
  CONFIDENT_GAP,
  MIN_CONFIDENT_SCORE,
  formatDay,
  recommend,
  latestTime,
  predict,
  predictionKey,
  type Confidence,
  type Prediction,
  type Storage,
} from "./expiry.js";
import type { FoodKeeper, FoodKeeperProduct, Match } from "./foodkeeper.js";

// Candidates scoring within this of the best count as tied. Scores are
// whole numbers today, so 1 means "equal or one point behind". A float
// equality check would miss "6 vs 5", which is under CONFIDENT_GAP and
// so not a real lead either. Pass nearTieMargin to consensus() to try
// another value; test-consensus.ts prints a sweep.
export const NEAR_TIE_MARGIN = 1;

// In step 4B, the category may decide a disagreement only for a pick
// whose own score is at least this. A score of 0 or less means the
// penalties ate all of its name evidence, and a category alone must
// not pick a product whose name did not match.
export const MIN_CATEGORY_EVIDENCE_SCORE = 1;

// Averaging is refused when, across the candidates, the longest lower
// bound is more than this many times the shortest one, or the same
// for upper bounds. 2 allows 3-5 next to 5-7 days, and refuses
// 1-2 days next to 3-14 days.
export const MAX_RANGE_RATIO = 2;

// What the UI shows for a no_match result.
export const NO_SUGGESTION_MESSAGE =
  "Sorry, we couldn't find a suggested best-before date. Please enter one manually.";

const DAY_MS = 24 * 60 * 60 * 1000;

export type Resolution = "consensus" | "reranked" | "averaged" | "no_match";

export type ConsensusCandidate = {
  product: FoodKeeperProduct;
  score: number;
  headHit: boolean;
  // 1-based position in each list, or null when that list lacked it.
  indexRank: number | null;
  categoryRank: number | null;
  prediction: Prediction;
  // Copied from the match when the semantic layer set them.
  familyBonus?: number;
  contradiction?: boolean;
  adjustments?: string[];
};

export type SuggestedRange = {
  earliest: Date;
  latest: Date;
  storage: Storage;
  label: string;
};

export type ConsensusResult = {
  resolution: Resolution;
  // The chosen product. For "averaged" it is the best-ranked of the
  // averaged ones, so the UI still has a name to show. null only for
  // no_match.
  selected: FoodKeeperProduct | null;
  // null when nothing could be dated: no_match, or a pick whose
  // FoodKeeper entry says "use the package date".
  range: SuggestedRange | null;
  confidence: Confidence | null;
  // true for averaged ranges and for the estimated fallbacks in
  // expiry.ts (category defaults, "Indefinitely" capped at 2 years).
  estimate: boolean;
  reason: string;
  // Credible candidates in consensus order, then the ones dropped in
  // step 2, so every product either list returned is accounted for.
  candidates: ConsensusCandidate[];
  dropped: ConsensusCandidate[];
  averagedFrom: ConsensusCandidate[];
  // Set only for no_match.
  message?: string;
};

function daysBetween(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / DAY_MS);
}

// Step 1. Index-first order first, then anything only category-first
// had, so the merge itself is deterministic.
function merge(
  foodKeeper: FoodKeeper,
  indexMatches: Match[],
  categoryMatches: Match[],
  bought: Date,
  preferredStorage?: Storage,
): ConsensusCandidate[] {
  const merged = new Map<number, ConsensusCandidate>();

  const add = (match: Match, rank: number, list: "index" | "category") => {
    let candidate = merged.get(match.product.id);
    if (!candidate) {
      candidate = {
        product: match.product,
        score: match.score,
        headHit: match.headHit,
        indexRank: null,
        categoryRank: null,
        prediction: predict(
          foodKeeper.storageWindows(match.product),
          match.product.categoryId,
          bought,
          preferredStorage,
        ),
        familyBonus: match.familyBonus,
        contradiction: match.contradiction,
        adjustments: match.adjustments,
      };
      merged.set(match.product.id, candidate);
    }

    // Same product, same query, same scoring, so the scores should be
    // equal. If a future change made them differ, keep the lower one,
    // so a disagreement can never inflate a candidate.
    candidate.score = Math.min(candidate.score, match.score);
    if (list === "index") candidate.indexRank ??= rank;
    else candidate.categoryRank ??= rank;
  };

  indexMatches.forEach((match, position) => add(match, position + 1, "index"));
  categoryMatches.forEach((match, position) => add(match, position + 1, "category"));

  return [...merged.values()];
}

// Step 3.
function compareCandidates(a: ConsensusCandidate, b: ConsensusCandidate): number {
  const both = (candidate: ConsensusCandidate) =>
    candidate.indexRank !== null && candidate.categoryRank !== null ? 0 : 1;
  const rank = (value: number | null) => value ?? Number.POSITIVE_INFINITY;

  return (
    b.score - a.score ||
    both(a) - both(b) ||
    latestTime(a.prediction) - latestTime(b.prediction) ||
    rank(a.indexRank) - rank(b.indexRank) ||
    rank(a.categoryRank) - rank(b.categoryRank) ||
    a.product.id - b.product.id
  );
}

// Step 4. Returns why averaging is refused, or null when it is fine.
// Checked in this order, so the reason names the first rule broken.
function incompatibility(candidates: ConsensusCandidate[]): string | null {
  const ranges = candidates.map((candidate) => candidate.prediction);

  for (const [position, prediction] of ranges.entries()) {
    const id = candidates[position].product.id;
    if (prediction.kind !== "range") return `#${id} has no numeric range (${prediction.kind})`;
    // Estimated ranges are our own defaults, not FoodKeeper data, so
    // averaging them would dress a guess up as a measurement.
    if (prediction.source !== "USDA") return `#${id} only has an estimated range`;
  }

  const numeric = ranges as Extract<Prediction, { kind: "range" }>[];

  const storages = new Set(numeric.map((prediction) => prediction.storage));
  if (storages.size > 1) return `different storage methods (${[...storages].join(", ")})`;

  // The FoodKeeper category is the nearest thing the data has to
  // "product type and preparation": it separates fresh, smoked, and
  // shelf-stable meat, for example.
  const categories = new Set(candidates.map((candidate) => candidate.product.categoryId));
  if (categories.size > 1) return "different FoodKeeper categories";

  return null;
}

function rangeDays(candidate: ConsensusCandidate, bought: Date): { min: number; max: number } {
  const prediction = candidate.prediction as Extract<Prediction, { kind: "range" }>;
  return { min: daysBetween(bought, prediction.earliest), max: daysBetween(bought, prediction.latest) };
}

function divergence(values: number[]): number {
  const low = Math.min(...values);
  const high = Math.max(...values);
  if (high === low) return 1;
  return low <= 0 ? Number.POSITIVE_INFINITY : high / low;
}

function rangeFrom(prediction: Prediction): SuggestedRange | null {
  if (prediction.kind !== "range") return null;
  return {
    earliest: prediction.earliest,
    latest: prediction.latest,
    storage: prediction.storage,
    label: prediction.label,
  };
}

export function describeCandidate(candidate: ConsensusCandidate): string {
  const { product } = candidate;
  return product.subtitle ? `${product.name} (${product.subtitle})` : product.name;
}

export type ConsensusOptions = {
  nearTieMargin?: number;
  // FoodKeeper category IDs for the item (categoryHints() in
  // expiry.ts). Used in steps 2 and 4B. Empty means "no category".
  categoryHints?: readonly number[];
  // Where the item is explicitly kept (semantic runs only). Picks the
  // storage window for every candidate's prediction.
  preferredStorage?: Storage;
};

// The pure part: takes the two lists already searched, so tests can
// hand it exact inputs. test-consensus.ts does the searching.
export function consensus(
  foodKeeper: FoodKeeper,
  indexMatches: Match[],
  categoryMatches: Match[],
  bought: Date,
  options: ConsensusOptions = {},
): ConsensusResult {
  const { nearTieMargin = NEAR_TIE_MARGIN, categoryHints = [], preferredStorage } = options;
  const hinted = new Set(categoryHints);
  const inCategory = (candidate: ConsensusCandidate) => hinted.has(candidate.product.categoryId);

  const merged = merge(foodKeeper, indexMatches, categoryMatches, bought, preferredStorage);
  const anyHeadHit = merged.some((candidate) => candidate.headHit);
  const credible = merged.filter((candidate) => candidate.headHit || inCategory(candidate) || !anyHeadHit);
  const dropped = merged.filter((candidate) => !credible.includes(candidate)).sort(compareCandidates);
  credible.sort(compareCandidates);

  const noMatch = (reason: string): ConsensusResult => ({
    candidates: credible,
    dropped,
    averagedFrom: [],
    resolution: "no_match",
    selected: null,
    range: null,
    confidence: null,
    estimate: false,
    reason,
    message: NO_SUGGESTION_MESSAGE,
  });

  if (credible.length === 0) {
    return noMatch(merged.length === 0 ? "neither search found a product" : "no credible candidate");
  }

  // What each strategy would have recommended on its own. Taking its
  // raw first result instead would ignore its own tiebreak and report
  // "disagreed" when both would have shown the user the same product.
  // A pick that step 2 dropped does not count as a pick.
  // recommend() expects best-first input, which search() always gives.
  // The stable sort makes that hold for any caller, so the input
  // order of equal scores is the only order-dependent part left.
  const ownPick = (matches: Match[]) => {
    const sorted = [...matches].sort((a, b) => b.score - a.score);
    const id = recommend(foodKeeper, sorted, sorted, bought, preferredStorage)?.matches[0]?.product.id;
    return credible.find((candidate) => candidate.product.id === id);
  };
  const indexPick = ownPick(indexMatches);
  const categoryPick = ownPick(categoryMatches);
  const shared = indexPick && indexPick === categoryPick ? indexPick : undefined;
  const picks = `index-first #${indexPick?.product.id ?? "none"}, category-first #${categoryPick?.product.id ?? "none"}`;

  // Builds the result for a chosen candidate. The chosen one goes
  // first in candidates, the rest keep the step-3 order.
  const choose = (pick: ConsensusCandidate, resolution: Resolution, basis: string): ConsensusResult => {
    const others = credible.filter((candidate) => candidate !== pick);
    const rival = others[0];
    const gap = rival ? pick.score - rival.score : Number.POSITIVE_INFINITY;
    const tied = others.filter((candidate) => candidate.score >= pick.score - nearTieMargin);
    const sameDates =
      tied.length > 0 &&
      tied.every((candidate) => predictionKey(candidate.prediction) === predictionKey(pick.prediction));

    let confidence: Confidence;
    let why: string;
    if (pick.score < MIN_CONFIDENT_SCORE) {
      confidence = "low";
      why = `score ${pick.score} is under ${MIN_CONFIDENT_SCORE}`;
    } else if (gap >= CONFIDENT_GAP) {
      confidence = "high";
      why = rival ? `ahead by ${gap}` : "only credible candidate";
    } else if (sameDates) {
      // Tied, but every tied row would put the same date on the item,
      // so which one is picked makes no difference to the user.
      confidence = "high";
      why = `near tie with ${tied.length} other(s), all predict the same dates`;
    } else if (gap <= 0) {
      confidence = "tie";
      why = `tied with #${rival!.product.id}`;
    } else {
      confidence = "low";
      why = `ahead by only ${gap}`;
    }

    const prediction = pick.prediction;
    return {
      candidates: [pick, ...others],
      dropped,
      averagedFrom: [],
      resolution,
      selected: pick.product,
      range: rangeFrom(prediction),
      confidence,
      estimate: prediction.kind === "range" && prediction.source === "estimated",
      reason:
        `${basis} (${picks}); ${why}` +
        (prediction.kind === "range"
          ? ""
          : `; no date: ${prediction.kind === "ask" ? prediction.detail : "no usable window"}`),
    };
  };

  // A. Agreement on a pick with real name evidence.
  if (shared && shared.score >= MIN_CONFIDENT_SCORE) {
    return choose(shared, "consensus", "both strategies picked it");
  }

  // B. Disagreement between two credible picks.
  if (!shared && indexPick && categoryPick) {
    const [stronger, weaker] =
      indexPick.score >= categoryPick.score ? [indexPick, categoryPick] : [categoryPick, indexPick];
    const lead = stronger.score - weaker.score;

    if (lead >= CONFIDENT_GAP && stronger.score >= MIN_CONFIDENT_SCORE) {
      return choose(stronger, "reranked", `name evidence decided: ahead of the other pick by ${lead}`);
    }
    if (inCategory(categoryPick) && !inCategory(indexPick) && categoryPick.score >= MIN_CATEGORY_EVIDENCE_SCORE) {
      return choose(
        categoryPick,
        "reranked",
        "name evidence was not decisive; only category-first's pick is in the item's category",
      );
    }
  }

  // C. No clear winner.
  const top = shared ?? credible[0];
  const nearTies = credible.filter((candidate) => candidate.score >= top.score - nearTieMargin);
  const sameDates = nearTies.every(
    (candidate) => predictionKey(candidate.prediction) === predictionKey(top.prediction),
  );
  const resolution: Resolution = top === shared ? "consensus" : "reranked";
  const basis = shared
    ? "both strategies picked it, but its score is weak"
    : "no decisive pick, took the top of the merged order";

  if (nearTies.length < 3 || sameDates) return choose(top, resolution, basis);

  const problem = incompatibility(nearTies);
  if (problem) {
    return noMatch(`${nearTies.length} near-tied candidates and no clear winner, not averaged: ${problem}`);
  }

  const days = nearTies.map((candidate) => rangeDays(candidate, bought));
  const minRatio = divergence(days.map((range) => range.min));
  const maxRatio = divergence(days.map((range) => range.max));
  if (minRatio > MAX_RANGE_RATIO || maxRatio > MAX_RANGE_RATIO) {
    return noMatch(`${nearTies.length} near-tied candidates and no clear winner, not averaged: ranges diverge too far`);
  }

  // Lower and upper bounds are averaged on their own, in days, so
  // weeks and months from different rows are on one scale first.
  const average = (values: number[]) => Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  const minDays = average(days.map((range) => range.min));
  const maxDays = average(days.map((range) => range.max));
  const earliest = new Date(bought);
  earliest.setDate(earliest.getDate() + minDays);
  const latest = new Date(bought);
  latest.setDate(latest.getDate() + maxDays);
  const first = top.prediction as Extract<Prediction, { kind: "range" }>;

  return {
    candidates: [top, ...credible.filter((candidate) => candidate !== top)],
    dropped,
    averagedFrom: nearTies,
    resolution: "averaged",
    selected: top.product,
    range: { earliest, latest, storage: first.storage, label: `${first.storage}, averaged` },
    // Averaging only happens because no single row won, so it is
    // never high confidence.
    confidence: "tie",
    estimate: true,
    reason: `${nearTies.length} near-tied candidates and no clear winner, averaged to ${minDays}-${maxDays} days`,
  };
}

export function describeRange(range: SuggestedRange | null): string {
  if (!range) return "no date";
  return `${formatDay(range.earliest)} to ${formatDay(range.latest)} (${range.label})`;
}
