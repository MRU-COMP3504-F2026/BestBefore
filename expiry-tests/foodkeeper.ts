// Loads the USDA FoodKeeper data and builds a word index over it.
// Not meant to be run on its own. match-seeded.ts imports it.
//
// foodkeeper.json is the FoodKeeper spreadsheet (FMA-Data) turned
// into JSON. It has six sheets. Two of them matter here:
//   Category   25 rows. ID, Category_Name, Subcategory_Name
//   Product    661 rows. Name, Name_subtitle, Keywords, Category_ID,
//              and a min / max / metric triple per storage window
// The other four (Version, CookingTips, CookingMethods, and the Data
// Dictionary) are left alone.
//
// Each row in the file is not a plain object. It is an array of
// one-key objects, like [{ ID: 1 }, { Name: "Butter" }, ...], so
// every row is flattened once on load.
//
// Search is the part that runs once per scanned item, so it is the
// part that has to be fast. A naive search would tokenize and score
// all 661 products for every item. Instead the index is built once:
// every word maps to the products that contain it, with a weight
// for where the word was found. A search only touches the products
// listed under the query's words, which is a handful, not 661.

import { readFileSync } from "node:fs";

// Field values in the sheets are a number, a string, or null.
type Cell = string | number | null;

type FlatRow = Record<string, Cell>;

type Sheet = {
  name: string;
  data: Record<string, Cell>[][];
};

export type FoodKeeperCategory = {
  id: number;
  name: string;
  subcategory: string | null;
};

// Only the fields the matcher reads are named. The storage columns
// (Pantry_Min, DOP_Refrigerate_Metric, ...) are reached through raw
// by name, since there are 27 of them and they follow one pattern.
export type FoodKeeperProduct = {
  id: number;
  categoryId: number;
  name: string;
  subtitle: string | null;
  keywords: string | null;
  raw: FlatRow;
};

// One storage window, such as "Fridge (from purchase): 1-2 Weeks".
// min and max are null for the metrics that are not a length of
// time (Indefinitely, When Ripe, Not Recommended, Package use-by).
export type StorageWindow = {
  key: string;
  label: string;
  min: number | null;
  max: number | null;
  metric: string;
};

// headHit is true when the product contains the item's head word (or
// a synonym of it). It does not change the score. It is there so a
// caller can tell "Yogurt" for "Greek Yogurt" apart from a product
// that only shared a side word like "greek" or "large".
// familyBonus is the part of score that came from familyWords (see
// search). It is 0 when no family words were passed. semantic-expansion.ts
// adds its own fields when it adjusts a match; search never sets them.
export type Match = {
  product: FoodKeeperProduct;
  score: number;
  headHit: boolean;
  familyBonus?: number;
  adjustment?: number;
  adjustments?: string[];
  contradiction?: boolean;
};

// Where a word was found decides how much it counts. A hit on the
// product name ("Yogurt") is a stronger signal than a hit buried in
// the keyword list ("Canned goods, ..., spinach").
const NAME_WEIGHT = 3;
const SUBTITLE_WEIGHT = 2;
const KEYWORD_WEIGHT = 1;

// Added once to any product that already matched a word and sits in
// one of the hinted categories. Big enough to break a tie between
// "Milk (plain)" in Dairy and "Milk (canned)" in Shelf Stable, small
// enough that it cannot make a product match on category alone.
const CATEGORY_BOOST = 2;

// Item names put the food last: "Baby Spinach", "Greek Yogurt",
// "Diced Tomatoes". Without this, "baby" (a name hit on Baby carrots)
// outscores "spinach" (a subtitle hit on Lettuce).
const HEAD_WORD_MULTIPLIER = 2;

// Taken off for each word in a product's name that the item name does
// not have. It keeps "Milk" from losing to "Soy milk", where both
// match "milk" but "soy" was never asked for.
const UNMATCHED_NAME_PENALTY = 2;

// The other direction: taken off for each word in the item name that
// FoodKeeper knows but this product does not have. It is what lets
// "Canned Diced Tomatoes" reach "Canned goods" instead of fresh
// "Tomatoes", which never mention "canned". A word FoodKeeper has no
// product for ("diced", "greek") costs every product the same, so
// it is not counted at all.
const MISSING_QUERY_WORD_PENALTY = 2;

// Family words (see search) count at half the weight of a word the
// item actually said, so a broad family term like "bread" or "cereal"
// can lift a product the name never reached, but cannot outweigh an
// exact name match. They are never counted as missing words either:
// a product not in the family is not penalized for it.
const FAMILY_WEIGHT = 0.5;

// Taken off for each variant word in a product's name or subtitle
// that the item did not ask for. FoodKeeper lists the plain food next
// to its variants ("Eggs (in shell)" beside "Eggs (hard boiled
// cooked)"), and a plain item name means the plain food. This is what
// breaks most ties for a reason instead of by ID.
const VARIANT_PENALTY = 2;

// Words that mark a prepared, processed, or special version of a food.
// "dry" and "fresh" are left out on purpose: dry pasta and fresh
// bagels are the default row, not the variant.
const VARIANT_WORDS = new Set(
  tokenizeRaw(
    "homemade shredded grated cooked boiled raw dried smoked vegan lactose " +
      "substitutes dishes thawed opened frozen canned instant powdered " +
      "concentrate mixes sauce jar bagged",
  ),
);

// Item-name word -> extra words to search for. Only for food words
// that FoodKeeper never uses, where the row exists under another
// name. The original word is still searched too. Kept short and
// generic: every entry is a real food synonym, not a fix for one
// fixture item.
const SYNONYMS: Record<string, string[]> = {
  croissant: ["roll"],
  baguette: ["bread"],
  bun: ["roll"],
  spaghetti: ["pasta"],
  penne: ["pasta"],
  macaroni: ["pasta"],
  fusilli: ["pasta"],
  linguine: ["pasta"],
  // "All-Purpose Flour". FoodKeeper calls it white flour.
  purpose: ["white"],
  // No "pop" -> "soda": in compound names it is not the drink, and
  // "Pop-Tarts" matched Baking soda. "cola" covers soft drinks.
  cola: ["soda"],
};

// Words that show up everywhere in names and keywords and say
// nothing about what the food is.
const STOP_WORDS = new Set([
  "and", "or", "the", "of", "in", "with", "such", "as", "a", "an",
  "etc", "for", "to", "on", "from", "not", "all", "any", "type", "types",
]);

// The storage columns, in the order they are printed. prefix is the
// column name without _Min / _Max / _Metric. "From purchase" is the
// DOP_ (date of purchase) set. The plain set has no stated start in
// the data dictionary, so it is printed without one.
const STORAGE_COLUMNS = [
  { key: "pantry", prefix: "Pantry", label: "Pantry" },
  { key: "pantryDop", prefix: "DOP_Pantry", label: "Pantry (from purchase)" },
  { key: "pantryOpened", prefix: "Pantry_After_Opening", label: "Pantry after opening" },
  { key: "fridge", prefix: "Refrigerate", label: "Fridge" },
  { key: "fridgeDop", prefix: "DOP_Refrigerate", label: "Fridge (from purchase)" },
  { key: "fridgeOpened", prefix: "Refrigerate_After_Opening", label: "Fridge after opening" },
  { key: "fridgeThawed", prefix: "Refrigerate_After_Thawing", label: "Fridge after thawing" },
  { key: "freezer", prefix: "Freeze", label: "Freezer" },
  { key: "freezerDop", prefix: "DOP_Freeze", label: "Freezer (from purchase)" },
] as const;

export type StorageKey = (typeof STORAGE_COLUMNS)[number]["key"];

// Lowercase words, letters only, with a rough plural strip so
// "Tomatoes" finds "tomato" and "Eggs" finds "egg". It is not a real
// stemmer. Words of three letters or fewer are left as they are so
// "gas" does not become "ga".
export function tokenize(text: string | null): string[] {
  return tokenizeRaw(text).filter((token) => !STOP_WORDS.has(token));
}

// tokenize without the stop-word filter. A function declaration, so
// VARIANT_WORDS above can call it before this line runs. STOP_WORDS
// is a const and is not ready yet at that point, which is why the
// filter lives in tokenize instead.
function tokenizeRaw(text: string | null): string[] {
  if (!text) return [];

  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  const tokens: string[] = [];

  for (const word of words) {
    let token = word;
    if (token.length > 4 && token.endsWith("oes")) {
      token = token.slice(0, -2);
    } else if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) {
      token = token.slice(0, -1);
    }

    tokens.push(token);
  }

  return tokens;
}

// [{ ID: 1 }, { Name: "Butter" }] -> { ID: 1, Name: "Butter" }
function flatten(row: Record<string, Cell>[]): FlatRow {
  return Object.assign({}, ...row);
}

function asNumber(value: Cell): number | null {
  return typeof value === "number" ? value : null;
}

function asText(value: Cell): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export class FoodKeeper {
  readonly categories = new Map<number, FoodKeeperCategory>();
  readonly products: FoodKeeperProduct[] = [];

  // word -> every product containing it, with that product's best
  // weight for the word. The weight is the max over name, subtitle,
  // and keywords, not the sum, so a word repeated in all three does
  // not count three times.
  private readonly index = new Map<string, Map<number, number>>();

  // Distinct words in each product's name, and the variant words in
  // its name and subtitle, by position in products. Precomputed so
  // search never tokenizes a product.
  private readonly nameLengths: number[] = [];
  private readonly variantWords: string[][] = [];

  constructor(path: string) {
    const file = JSON.parse(readFileSync(path, "utf8")) as { sheets: Sheet[] };

    const sheet = (name: string) => {
      const found = file.sheets.find((item) => item.name === name);
      if (!found) throw new Error(`Sheet "${name}" is missing from ${path}`);
      return found.data.map(flatten);
    };

    for (const row of sheet("Category")) {
      const id = asNumber(row.ID);
      const name = asText(row.Category_Name);
      if (id === null || name === null) continue;

      this.categories.set(id, { id, name, subcategory: asText(row.Subcategory_Name) });
    }

    for (const row of sheet("Product")) {
      const id = asNumber(row.ID);
      const categoryId = asNumber(row.Category_ID);
      const name = asText(row.Name);
      if (id === null || categoryId === null || name === null) continue;

      this.products.push({
        id,
        categoryId,
        name,
        subtitle: asText(row.Name_subtitle),
        keywords: asText(row.Keywords),
        raw: row,
      });
    }

    this.buildIndex();
  }

  private buildIndex() {
    this.products.forEach((product, position) => {
      this.nameLengths[position] = new Set(tokenize(product.name)).size;
      this.variantWords[position] = [
        ...new Set([...tokenize(product.name), ...tokenize(product.subtitle)]),
      ].filter((token) => VARIANT_WORDS.has(token));

      const fields: [string | null, number][] = [
        [product.name, NAME_WEIGHT],
        [product.subtitle, SUBTITLE_WEIGHT],
        [product.keywords, KEYWORD_WEIGHT],
      ];

      for (const [text, weight] of fields) {
        for (const token of tokenize(text)) {
          let postings = this.index.get(token);
          if (!postings) {
            postings = new Map();
            this.index.set(token, postings);
          }

          const best = postings.get(position) ?? 0;
          if (weight > best) postings.set(position, weight);
        }
      }
    });
  }

  get indexSize(): number {
    return this.index.size;
  }

  // Best matches for a free-text name, highest score first.
  //   hints         FoodKeeper category IDs that get CATEGORY_BOOST
  //   extraWords    more words to search for that are not in the name,
  //                 such as "canned" from a unit of "cans". They score
  //                 like name words but are never the head word
  //   familyWords   broad food-family terms from semantic-expansion.ts
  //                 ("cereal", "bread"). Scored at FAMILY_WEIGHT, never
  //                 missing, never the head. A family hit on a product's
  //                 name still counts as a matched name word, so the
  //                 unmatched-name penalty does not punish it twice
  //   onlyCategories  drops every product outside those categories.
  //                 That is the category-first strategy. It filters
  //                 after the postings are summed, so it costs nothing
  //   limit         how many to return
  // Ties go to the product with the shorter name, then to the lower
  // ID. Callers that know more (expiry.ts can compare shelf lives)
  // should ask for a bigger limit and break ties themselves.
  search(
    text: string,
    options: {
      hints?: readonly number[];
      extraWords?: readonly string[];
      familyWords?: readonly string[];
      onlyCategories?: ReadonlySet<number>;
      limit?: number;
    } = {},
  ): Match[] {
    const { hints: categoryHints = [], extraWords = [], familyWords = [], onlyCategories, limit = 3 } = options;
    const scores = new Map<number, number>();
    const nameHits = new Map<number, number>();
    const wordHits = new Map<number, number>();

    // The head word is the last word of the name itself. A synonym of
    // the head is a head too, so "Croissants" -> "roll" still counts
    // double. Extra words are added last and are never the head.
    const nameTokens = tokenize(text);
    const headWord = nameTokens[nameTokens.length - 1];
    const heads = new Set([headWord, ...(SYNONYMS[headWord] ?? [])]);

    // A Set so "Milk Milk" in an item name does not score twice.
    const tokens = [
      ...new Set([
        ...nameTokens,
        ...nameTokens.flatMap((token) => SYNONYMS[token] ?? []),
        ...extraWords.flatMap((word) => tokenize(word)),
      ]),
    ];
    const asked = new Set(tokens);
    const headHits = new Set<number>();
    let knownWords = 0;

    for (const token of tokens) {
      const postings = this.index.get(token);
      if (!postings) continue;

      knownWords++;
      const isHead = heads.has(token);
      const multiplier = isHead ? HEAD_WORD_MULTIPLIER : 1;

      for (const [position, weight] of postings) {
        if (isHead) headHits.add(position);
        scores.set(position, (scores.get(position) ?? 0) + weight * multiplier);
        wordHits.set(position, (wordHits.get(position) ?? 0) + 1);
        if (weight === NAME_WEIGHT) {
          nameHits.set(position, (nameHits.get(position) ?? 0) + 1);
        }
      }
    }

    // Family words the item did not already say. Kept apart from the
    // loop above so they never touch knownWords or wordHits.
    const familyBonus = new Map<number, number>();
    const familyTokens = new Set(familyWords.flatMap((word) => tokenize(word)).filter((token) => !asked.has(token)));
    for (const token of familyTokens) {
      for (const [position, weight] of this.index.get(token) ?? []) {
        scores.set(position, (scores.get(position) ?? 0) + weight * FAMILY_WEIGHT);
        familyBonus.set(position, (familyBonus.get(position) ?? 0) + weight * FAMILY_WEIGHT);
        if (weight === NAME_WEIGHT) {
          nameHits.set(position, (nameHits.get(position) ?? 0) + 1);
        }
      }
    }

    const hints = new Set(categoryHints);
    const matches: (Omit<Match, "headHit"> & { position: number })[] = [];

    for (const [position, score] of scores) {
      const product = this.products[position];
      if (onlyCategories && !onlyCategories.has(product.categoryId)) continue;

      const boost = hints.has(product.categoryId) ? CATEGORY_BOOST : 0;
      const unmatched = this.nameLengths[position] - (nameHits.get(position) ?? 0);
      const missing = knownWords - (wordHits.get(position) ?? 0);
      const variants = this.variantWords[position].filter((token) => !asked.has(token)).length;
      matches.push({
        product,
        position,
        score:
          score +
          boost -
          unmatched * UNMATCHED_NAME_PENALTY -
          missing * MISSING_QUERY_WORD_PENALTY -
          variants * VARIANT_PENALTY,
      });
    }

    matches.sort(
      (a, b) =>
        b.score - a.score ||
        this.nameLengths[a.position] - this.nameLengths[b.position] ||
        a.product.id - b.product.id,
    );

    return matches
      .slice(0, limit)
      .map(({ product, score, position }) => ({
        product,
        score,
        headHit: headHits.has(position),
        familyBonus: familyBonus.get(position) ?? 0,
      }));
  }

  categoryLabel(id: number): string {
    const category = this.categories.get(id);
    if (!category) return `Unknown category ${id}`;
    return category.subcategory ? `${category.name} / ${category.subcategory}` : category.name;
  }

  // Every storage window that has a metric. A column set with no
  // metric means the USDA gave no advice for that storage, and it is
  // skipped.
  storageWindows(product: FoodKeeperProduct): StorageWindow[] {
    const windows: StorageWindow[] = [];

    for (const column of STORAGE_COLUMNS) {
      const metric = asText(product.raw[`${column.prefix}_Metric`]);
      if (metric === null) continue;

      windows.push({
        key: column.key,
        label: column.label,
        min: asNumber(product.raw[`${column.prefix}_Min`]),
        max: asNumber(product.raw[`${column.prefix}_Max`]),
        metric,
      });
    }

    return windows;
  }
}
