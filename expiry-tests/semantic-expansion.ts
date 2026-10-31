// Lightweight semantic layer on top of the word search: food families,
// explicit storage state, and explicit preparation/packaging evidence.
// Not meant to be run on its own. strategies.ts and test-consensus.ts
// use it for their "+semantic" runs; the plain runs never call it.
//
// It never replaces the item's own words. It only:
//   1. adds family words to a second search (expand -> familyWords),
//      so a FoodKeeper row filed under a broad name ("Cereal",
//      "Commercial bread products") can be found at all
//   2. merges that search with the original one, so nothing the
//      original found is lost (applySemantics)
//   3. nudges scores up or down for evidence the item states outright
//      (applySemantics), and records each nudge for debugging
//   4. caps confidence when a pick only won through family words or
//      contradicts the item (calibrate)
//
// Everything is driven by small word lists, tokenized the same way as
// FoodKeeper, so "Buns" and "bun" are one word. No list names a
// fixture product: each rule is a food family or an attribute.

import type { Confidence, Storage } from "./expiry.js";
import { tokenize, type FoodKeeper, type Match } from "./foodkeeper.js";

// The item fields this layer reads. FixtureItem and a database row
// both have them.
export type SemanticItem = {
  name: string;
  category: string | null;
  unit: string | null;
  brand: string | null;
  barcode: string | null;
};

export type SemanticExpansion = {
  // Where the item is explicitly kept. null means unknown, and
  // unknown changes nothing.
  storage: Storage | null;
  storageEvidence: string | null;
  // Preparation words the item's name actually contains.
  attributes: string[];
  // A brand or a barcode: the item came from a store, so it is a
  // commercially made product. Nothing more is inferred from it (not
  // pasteurized, not shelf-stable).
  packaged: boolean;
  families: string[];
  familyWords: string[];
  // false when attributes were switched off (an ablation run), so the
  // form check is skipped too.
  attributeChecks: boolean;
};

export type SemanticOptions = {
  families?: boolean;
  storage?: boolean;
  attributes?: boolean;
};

const words = (text: string) => new Set(tokenize(text));

// A family fires when the item's head word (its last word, the food
// itself) is one of its triggers. "Blueberry Muffins" is a muffin, not
// a berry, so the berry family does not fire for it; "Frozen
// Blueberries" is a berry, so it does. requires, when set, is a second
// word the item must also contain.
type FamilyRule = {
  id: string;
  heads: Set<string>;
  requires?: Set<string>;
  words: string[];
};

const FRUIT_WORDS = words(
  "apple apples grape grapes pear pears peach peaches pineapple mango mangoes cherry cherries plum plums " +
    "banana bananas melon melons cranberry cranberries blueberry blueberries strawberry strawberries " +
    "raspberry raspberries blackberry blackberries lemon lemons lime limes orange oranges grapefruit fruit",
);

const FAMILIES: FamilyRule[] = [
  {
    id: "bread",
    heads: words("bun buns roll rolls loaf loaves baguette croissant croissants brioche sourdough pita naan ciabatta bread"),
    words: ["bread", "roll", "bun"],
  },
  {
    id: "ready-to-eat cereal",
    heads: words("flakes flake cereal puffs crisps loops"),
    words: ["cereal", "ready", "eat"],
  },
  {
    id: "hot cereal",
    heads: words("oatmeal porridge"),
    words: ["cereal", "cook", "oatmeal"],
  },
  {
    // Oats that are sold as a breakfast cereal say how they are cut.
    id: "hot cereal",
    heads: words("oats oat"),
    requires: words("quick instant rolled steel"),
    words: ["cereal", "cook", "oatmeal"],
  },
  {
    id: "citrus",
    heads: words("lemon lemons lime limes orange oranges grapefruit tangerine tangerines clementine clementines mandarin mandarins"),
    words: ["citrus", "fruit"],
  },
  {
    id: "berries",
    heads: words("blueberry blueberries strawberry strawberries raspberry raspberries blackberry blackberries cranberry cranberries"),
    words: ["berries", "fruit"],
  },
  {
    id: "fruit juice",
    heads: words("juice"),
    requires: FRUIT_WORDS,
    words: ["fruit", "juice"],
  },
];

// Name words that mean the FoodKeeper row is a different form of the
// food: "Lemon juice" is not lemons, "Corn syrup" is not corn flakes.
// Checked on the row's name only, because subtitles list examples
// ("high acid (juices, fruit, pickles, ...)") that are not its form.
// "sauce" is not here: the variant penalty in foodkeeper.ts covers it.
export const FORM_WORDS = words("juice juices jam jelly syrup paste powder pie pies soda oil chips flour vinegar soup salad");

// With packaging evidence: rows made at home contradict it, rows that
// say they are commercial support it.
const HOME_WORDS = words("homemade home squeezed");
const COMMERCIAL_WORDS = words("commercial commercially packaged carton cartons bottled");

// Preparation words read from the item's name. Only these, and only
// when present: a missing word is unknown, not "no".
const ATTRIBUTE_WORDS = words("raw cooked fresh frozen smoked canned dried homemade pasteurized unpasteurized ground whole");
const CONTRADICTIONS: [string, Set<string>][] = [
  [tokenize("raw")[0], words("cooked boiled baked fried roasted")],
  [tokenize("cooked")[0], words("raw uncooked")],
];

const FROZEN_CATEGORY = 8;

// Documented nudges, all small next to a name hit (3, or 6 on the
// head word), so none of them can carry a product the name did not
// reach.
const FORM_PENALTY = 2;
const HOME_PENALTY = 2;
const COMMERCIAL_SUPPORT = 1;
const CONTRADICTION_PENALTY = 2;
const STORAGE_SUPPORT = 2;

export function expand(item: SemanticItem, options: SemanticOptions = {}): SemanticExpansion {
  const { families: useFamilies = true, storage: useStorage = true, attributes: useAttributes = true } = options;
  const tokens = tokenize(item.name);
  const tokenSet = new Set(tokens);
  const head = tokens[tokens.length - 1];

  let storage: Storage | null = null;
  let storageEvidence: string | null = null;
  if (useStorage) {
    if (tokenSet.has("frozen")) [storage, storageEvidence] = ["freezer", 'name says "frozen"'];
    else if (item.category === "Frozen") [storage, storageEvidence] = ["freezer", 'category is "Frozen"'];
    else if (tokenSet.has("refrigerated") || tokenSet.has("chilled")) {
      [storage, storageEvidence] = ["fridge", "name says refrigerated"];
    }
  }

  const families: string[] = [];
  const familyWords: string[] = [];
  if (useFamilies && head) {
    for (const rule of FAMILIES) {
      if (!rule.heads.has(head)) continue;
      if (rule.requires && !tokens.some((token) => rule.requires!.has(token))) continue;
      if (families.includes(rule.id)) continue;
      families.push(rule.id);
      familyWords.push(...rule.words);
    }
  }

  return {
    storage,
    storageEvidence,
    attributes: useAttributes ? tokens.filter((token) => ATTRIBUTE_WORDS.has(token)) : [],
    packaged: useAttributes && Boolean(item.brand || item.barcode),
    families,
    familyWords: [...new Set(familyWords)],
    attributeChecks: useAttributes,
  };
}

// Merges several result lists for one item and applies the evidence
// nudges. Lists are merged by FoodKeeper ID; a product found by more
// than one keeps its best score, which is the one from the search
// that also had the family words (that search only ever adds to a
// score). Original order is kept for equal scores, so results stay
// deterministic. Nothing is removed.
// storageWordOnly lists rows that matched only the item's storage word
// ("frozen"). They are kept, marked, and ranked after every other row.
export function applySemantics(
  foodKeeper: FoodKeeper,
  item: SemanticItem,
  expansion: SemanticExpansion,
  lists: Match[][],
  storageWordOnly: ReadonlySet<number> = new Set(),
): Match[] {
  const merged = new Map<number, Match>();
  for (const list of lists) {
    for (const match of list) {
      const existing = merged.get(match.product.id);
      if (!existing || match.score > existing.score) {
        merged.set(match.product.id, { ...match, headHit: match.headHit || Boolean(existing?.headHit) });
      }
    }
  }

  const itemTokens = new Set(tokenize(item.name));
  const results = [...merged.values()].map((match) => {
    const { product } = match;
    const nameTokens = new Set(tokenize(product.name));
    const allTokens = new Set([...nameTokens, ...tokenize(product.subtitle)]);
    const notes: string[] = [];
    let adjustment = 0;
    let contradiction = false;

    const forms = [...nameTokens].filter((token) => FORM_WORDS.has(token) && !itemTokens.has(token));
    if (forms.length > 0 && expansion.attributeChecks) {
      adjustment -= FORM_PENALTY * forms.length;
      notes.push(`form ${forms.join("/")} not in item -${FORM_PENALTY * forms.length}`);
    }

    if (expansion.packaged) {
      const home = [...allTokens].filter((token) => HOME_WORDS.has(token));
      if (home.length > 0) {
        adjustment -= HOME_PENALTY;
        contradiction = true;
        notes.push(`homemade/fresh-squeezed row, but item has a brand or barcode -${HOME_PENALTY}`);
      } else if ([...allTokens].some((token) => COMMERCIAL_WORDS.has(token))) {
        adjustment += COMMERCIAL_SUPPORT;
        notes.push(`commercial row, item has a brand or barcode +${COMMERCIAL_SUPPORT}`);
      }
    }

    for (const [attribute, opposites] of CONTRADICTIONS) {
      if (!expansion.attributes.includes(attribute)) continue;
      const clash = [...allTokens].filter((token) => opposites.has(token));
      if (clash.length > 0) {
        adjustment -= CONTRADICTION_PENALTY;
        contradiction = true;
        notes.push(`item is ${attribute}, row is ${clash.join("/")} -${CONTRADICTION_PENALTY}`);
      }
    }

    const onlyStorageWord = storageWordOnly.has(product.id);
    if (onlyStorageWord) {
      notes.push("matched only the storage word, ranked last");
    } else if (expansion.storage === "freezer" && (product.categoryId === FROZEN_CATEGORY || allTokens.has("frozen"))) {
      adjustment += STORAGE_SUPPORT;
      notes.push(`frozen row, item is explicitly frozen +${STORAGE_SUPPORT}`);
    }

    return {
      ...match,
      score: match.score + adjustment,
      adjustment,
      adjustments: notes,
      contradiction,
      onlyStorageWord,
    };
  });

  // Stable sort: equal scores keep merge order, which is the order of
  // the original search first.
  return results
    .sort((a, b) => Number(a.onlyStorageWord) - Number(b.onlyStorageWord) || b.score - a.score)
    .map(({ onlyStorageWord: _, ...match }) => match);
}

// Caps a confidence label for the semantic run:
//   a pick that contradicts the item       -> at most "low"
//   high only because of family words      -> "medium"
// "Only because" means: without its family bonus the pick would not
// clear minScore, or would not lead the rival by minGap. Agreement
// between strategies is never consulted here.
export function calibrate(
  confidence: Confidence | null,
  pick: Pick<Match, "score" | "familyBonus" | "contradiction"> | undefined,
  rival: Pick<Match, "score"> | undefined,
  minScore: number,
  minGap: number,
): Confidence | null {
  if (!confidence || !pick) return confidence;
  if (pick.contradiction && (confidence === "high" || confidence === "medium")) return "low";
  if (confidence !== "high") return confidence;

  const ownScore = pick.score - (pick.familyBonus ?? 0);
  const ownGap = rival ? ownScore - rival.score : Number.POSITIVE_INFINITY;
  return ownScore >= minScore && ownGap >= minGap ? "high" : "medium";
}
