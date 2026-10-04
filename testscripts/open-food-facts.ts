export { };

const barcode = "3017624010701";

const fields = [
  "code",
  "product_name",
  "brands",
  "quantity",
  "categories",
  "categories_tags",
  "countries",
  "countries_tags",
  "image_front_url",
  "ingredients_text",
  "nutriments",
].join(",");

const url =
  `https://world.openfoodfacts.org/api/v3/product/${barcode}` +
  `?fields=${fields}`;

const response = await fetch(url, {
  headers: {
    "User-Agent": "BestBefore/0.1 (development playground)",
  },
});

if (!response.ok) {
  throw new Error(`Open Food Facts returned ${response.status}`);
}

const data = await response.json();

console.dir(data, { depth: null });
