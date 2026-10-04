import { config } from "dotenv";

config({ path: ".env.local" });

const GO_UPC_API_KEY = process.env.GO_UPC_API_KEY;

const barcode = "3017624010701";

const response = await fetch(
  `https://go-upc.com/api/v1/code/${barcode}`,
  {
    headers: {
      Authorization: `Bearer ${GO_UPC_API_KEY}`,
      Accept: "application/json",
    },
  }
);

console.log(`HTTP ${response.status}`);

const data = await response.json();

console.dir(data, {
  depth: null,
  colors: true,
});
