export { };

const barcode = "3017624010701";

const url =
  `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(barcode)}`;

const response = await fetch(url, {
  headers: {
    Accept: "application/json",
  },
});

if (!response.ok) {
  throw new Error(
    `UPCitemdb returned ${response.status}: ${response.statusText}`
  );
}

const data = await response.json();

console.dir(data, { depth: null });
