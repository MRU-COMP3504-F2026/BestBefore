// Turning a FoodKeeper match into a best-before. Shared by
// match-seeded.ts and the strategy tests, so they all predict the
// same way and only the search differs.
// Not meant to be run on its own.

import type { FoodKeeper, Match, StorageKey, StorageWindow } from "./foodkeeper.js";

// Our category -> FoodKeeper category IDs (see the Category sheet).
// A category not listed here gets no boost, which is fine. The word
// match still runs. The lists are wider than the names suggest
// because FoodKeeper files some shelf foods where a shopper would not
// look: flour is under Baking and Cooking (3), not Shelf Stable, and
// tortillas are under Grains (9), not Bakery.
export const CATEGORY_HINTS: Record<string, number[]> = {
  Dairy: [7],
  Produce: [18, 19],
  Pantry: [3, 6, 9, 23],
  Meat: [10, 11, 12, 13],
  Poultry: [14, 15, 16, 17],
  Seafood: [20, 21, 22],
  Bakery: [2, 3, 4, 9],
  Beverages: [5],
  Frozen: [8],
  Deli: [25],
};

export function categoryHints(category: string | null): number[] {
  return (category && CATEGORY_HINTS[category]) || [];
}

// Our unit column -> words that say how the food is packed. "3 cans"
// of soup is canned soup even when the name never says so, and the
// FoodKeeper rows for canned food all say "canned".
const UNIT_WORDS: Record<string, string> = {
  can: "canned",
  cans: "canned",
  tin: "canned",
  tins: "canned",
  jar: "jar",
  jars: "jar",
  bag: "bagged",
  bags: "bagged",
  bottle: "bottled",
  bottles: "bottled",
};

export function unitWords(unit: string | null): string[] {
  const word = unit && UNIT_WORDS[unit.trim().toLowerCase()];
  return word ? [word] : [];
}

// Which windows to try, in order, for a prediction. Only unopened
// windows are listed. An item comes home sealed, so "after opening"
// would understate how long it lasts on the shelf. The freezer is
// left out of the usual lists on purpose: nobody freezes milk by
// default, so a 3-month freezer date would be a wrong best-before,
// not a fallback. Only food bought frozen starts there.
const FRIDGE_FIRST: StorageKey[] = ["fridgeDop", "fridge", "pantryDop", "pantry"];
const PANTRY_FIRST: StorageKey[] = ["pantryDop", "pantry", "fridgeDop", "fridge"];
const FREEZER_FIRST: StorageKey[] = ["freezerDop", "freezer"];

// FoodKeeper category IDs that live on the shelf: Bakery, Baking and
// Cooking, Beverages, Condiments / Sauces / Canned Goods, Grains /
// Beans / Pasta, shelf-stable Meat and Poultry, Shelf Stable Foods.
// Everything else, including Refrigerated Dough, goes fridge first.
const PANTRY_CATEGORIES = new Set([2, 3, 5, 6, 9, 11, 16, 23]);
const FROZEN_CATEGORY = 8;

const PREFERRED_KEYS: Record<Storage, StorageKey[]> = {
  freezer: FREEZER_FIRST,
  fridge: ["fridgeDop", "fridge"],
  pantry: ["pantryDop", "pantry"],
};

function storagePreference(foodKeeperCategoryId: number): StorageKey[] {
  if (foodKeeperCategoryId === FROZEN_CATEGORY) return FREEZER_FIRST;
  if (PANTRY_CATEGORIES.has(foodKeeperCategoryId)) return PANTRY_FIRST;
  return FRIDGE_FIRST;
}

// Our own guesses, not USDA numbers. Used only when none of the
// preferred windows is a length of time, which for produce usually
// means FoodKeeper said "When Ripe" (tomatoes, avocados, bananas).
// Keyed by FoodKeeper category ID. Days in the fridge.
const DEFAULT_WINDOWS: Record<number, { label: string; min: number; max: number }> = {
  18: { label: "Fresh fruit default", min: 3, max: 7 },
  19: { label: "Fresh vegetable default", min: 5, max: 7 },
};

// "Indefinitely" still needs a date to sort on. Two years keeps a
// can of salt at the bottom of the expiring-soon list without
// pretending it ever goes off.
const INDEFINITE_CAP_YEARS = 2;

// Score gap between the pick and the best rival. At or above this
// the pick is taken as-is. Below it, the app should offer the
// candidates.
export const CONFIDENT_GAP = 2;

// A pick scoring under this is never "high", however far ahead it
// is. One plain name hit on the head word with the category boost
// scores 8, so 4 means "matched something, barely".
export const MIN_CONFIDENT_SCORE = 4;

// "Year" shows up once in the data next to the usual "Years".
const DAYS_PER_UNIT: Record<string, number> = {
  Hours: 1 / 24,
  Days: 1,
  Weeks: 7,
};
const MONTHS_PER_UNIT: Record<string, number> = {
  Months: 1,
  Year: 12,
  Years: 12,
};

// YYYY-MM-DD -> a local Date at midnight. new Date("2026-10-31")
// would parse as UTC and can land on the previous day.
export function parseDay(text: string): Date {
  const [year, month, day] = text.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function formatDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

// Months are added on the calendar (Oct 31 + 1 month = Dec 1, which
// is what Date does with Nov 31) instead of as 30 days. Hours round
// up to a whole day, since best-before is a date.
// Returns null for a metric that is not a length of time.
function addAmount(start: Date, amount: number, metric: string): Date | null {
  const date = new Date(start);

  if (metric in DAYS_PER_UNIT) {
    date.setDate(date.getDate() + Math.ceil(amount * DAYS_PER_UNIT[metric]));
    return date;
  }

  if (metric in MONTHS_PER_UNIT) {
    date.setMonth(date.getMonth() + amount * MONTHS_PER_UNIT[metric]);
    return date;
  }

  return null;
}

// "1-2 Weeks", "3 Days" when min equals max, or just the metric text
// for "Indefinitely" and the other non-durations.
export function describeWindow(window: StorageWindow): string {
  if (window.min === null && window.max === null) return window.metric;
  if (window.min === window.max || window.max === null) return `${window.min} ${window.metric}`;
  if (window.min === null) return `up to ${window.max} ${window.metric}`;
  return `${window.min}-${window.max} ${window.metric}`;
}

export type Storage = "pantry" | "fridge" | "freezer";

// StorageKey -> where the food sits. "fridgeDop" and "fridge" are both
// the fridge; they differ only in what the clock starts from.
function storageOf(key: StorageKey): Storage {
  if (key.startsWith("pantry")) return "pantry";
  if (key.startsWith("freezer")) return "freezer";
  return "fridge";
}

export type Prediction =
  | {
      kind: "range";
      label: string;
      storage: Storage;
      earliest: Date;
      latest: Date;
      detail: string;
      source: "USDA" | "estimated";
    }
  | { kind: "ask"; label: string; detail: string }
  | { kind: "none"; detail: string };

// Walks the preferred windows in order and returns the first answer:
//   a length of time      purchase date + min / max          [USDA]
//   Package use-by date   ask the user for the printed date
//   Indefinitely          purchase date + INDEFINITE_CAP_YEARS [estimated]
//   When Ripe, Not Recommended, anything else
//                         skipped, so the next window gets a turn
// If nothing answered, the category default fills in, if there is one.
//
// preferredStorage is where the item is explicitly kept, when the item
// says so ("Frozen Blueberries"). Its windows are tried first, then the
// usual order. Without it, nothing changes. Matching the food and
// picking which of its storage windows to use are separate steps: a
// FoodKeeper row with both fridge and freezer times is one food.
export function predict(
  windows: StorageWindow[],
  foodKeeperCategoryId: number,
  bought: Date,
  preferredStorage?: Storage,
): Prediction {
  const usual = storagePreference(foodKeeperCategoryId);
  const first = preferredStorage ? PREFERRED_KEYS[preferredStorage] : [];
  for (const key of [...new Set([...first, ...usual])]) {
    const window = windows.find((item) => item.key === key);
    if (!window) continue;

    if (window.min !== null) {
      const earliest = addAmount(bought, window.min, window.metric);
      const latest = addAmount(bought, window.max ?? window.min, window.metric);
      if (earliest && latest) {
        return {
          kind: "range",
          label: window.label,
          storage: storageOf(key),
          earliest,
          latest,
          detail: describeWindow(window),
          source: "USDA",
        };
      }
    }

    if (window.metric === "Package use-by date") {
      return { kind: "ask", label: window.label, detail: "use the date printed on the package" };
    }

    if (window.metric === "Indefinitely") {
      const capped = new Date(bought);
      capped.setFullYear(capped.getFullYear() + INDEFINITE_CAP_YEARS);
      return {
        kind: "range",
        label: window.label,
        storage: storageOf(key),
        earliest: capped,
        latest: capped,
        detail: `Indefinitely, capped at ${INDEFINITE_CAP_YEARS} years`,
        source: "estimated",
      };
    }
  }

  const fallback = DEFAULT_WINDOWS[foodKeeperCategoryId];
  if (fallback) {
    const earliest = new Date(bought);
    earliest.setDate(earliest.getDate() + fallback.min);
    const latest = new Date(bought);
    latest.setDate(latest.getDate() + fallback.max);
    return {
      kind: "range",
      label: `Fridge (${fallback.label})`,
      storage: "fridge",
      earliest,
      latest,
      detail: `${fallback.min}-${fallback.max} Days`,
      source: "estimated",
    };
  }

  return { kind: "none", detail: "no usable pantry or fridge window and no default for this category" };
}

// "medium" is only produced by the semantic layer: a pick that would
// be high, but whose lead depends on broad family terms rather than
// the item's own words. See calibrate() in semantic-expansion.ts.
export type Confidence = "high" | "medium" | "low" | "tie";

export type Recommendation = {
  // The pick first, then up to two alternatives.
  matches: Match[];
  prediction: Prediction;
  confidence: Confidence;
  reason: string;
};

// Two predictions that would put the same dates on the item.
export function predictionKey(prediction: Prediction): string {
  if (prediction.kind !== "range") return prediction.kind;
  return `${formatDay(prediction.earliest)}|${formatDay(prediction.latest)}`;
}

// When the tied candidates disagree, the one that goes off soonest
// wins. This is a recommendation, so erring early is the safe side: a
// reminder that comes too soon costs nothing, and one that comes too
// late costs a meal. "ask" and "none" have no date, so they sort last.
export function latestTime(prediction: Prediction): number {
  return prediction.kind === "range" ? prediction.latest.getTime() : Number.POSITIVE_INFINITY;
}

// Turns raw search results into one recommendation.
//   matches       what the strategy returned, best first. Ask for
//                 more than 3 so a 4-way tie can still be broken
//   fullMatches   the plain index-first search for the same item.
//                 Confidence is measured against it, so a category
//                 filter that threw out the right answer cannot make
//                 a weak pick look strong. Pass matches again when the
//                 strategy already was the full search
// Returns null when there is nothing to recommend.
export function recommend(
  foodKeeper: FoodKeeper,
  matches: Match[],
  fullMatches: Match[],
  bought: Date,
  preferredStorage?: Storage,
): Recommendation | null {
  if (matches.length === 0) return null;

  const predictionFor = (match: Match) =>
    predict(foodKeeper.storageWindows(match.product), match.product.categoryId, bought, preferredStorage);

  const topScore = matches[0].score;
  const tied = matches
    .filter((match) => match.score === topScore)
    .map((match) => ({ match, prediction: predictionFor(match) }));

  // sort is stable, so equal shelf lives keep search's own order.
  tied.sort((a, b) => latestTime(a.prediction) - latestTime(b.prediction));

  const ordered = [...tied.map((entry) => entry.match), ...matches.slice(tied.length)];
  const pick = ordered[0];
  const prediction = tied[0].prediction;
  const result = (confidence: Confidence, reason: string): Recommendation => ({
    matches: ordered.slice(0, 3),
    prediction,
    confidence,
    reason,
  });

  if (pick.score < MIN_CONFIDENT_SCORE) {
    return result("low", `best score ${pick.score} is under ${MIN_CONFIDENT_SCORE}`);
  }

  if (tied.length > 1) {
    const sameDates = tied.every((entry) => predictionKey(entry.prediction) === predictionKey(prediction));
    return sameDates
      ? result("high", `${tied.length}-way tie, but every tied match predicts the same dates`)
      : result("tie", `${tied.length}-way tie, picked the shortest shelf life`);
  }

  const rival = [...fullMatches, ...matches].find((match) => match.product.id !== pick.product.id);
  if (!rival) return result("high", "only candidate in the full search");

  const gap = pick.score - rival.score;
  if (gap < 0) {
    return result("low", `the full search has a better match: #${rival.product.id} ${rival.product.name}`);
  }
  if (gap < CONFIDENT_GAP) return result("low", `ahead by ${gap}`);
  return result("high", `ahead by ${gap}`);
}
