# Communication Channel

Discord Server : [Discord Server Invite Link](https://discord.gg/Um6jbRySf)


# Shared Google Folder

Google Folder : [Shared Google Folder link](https://drive.google.com/drive/folders/1YLpEIZINHW01mx4GEqY0jmETjuSrf7c4?usp=sharing)

# Project Members

- Brian Nguyen
- Daniel Eliezer
- Lihini Herath
- Fara Omidiji
- Armandeep Grewal

# ~~Jira~~ GitHub Projects

Jira has been scrapped for GitHub Projects instead.

GitHub Project Link: [BestBefore Project](https://github.com/orgs/MRU-COMP3504-F2026/projects/1/views/1?visibleFields=%5B%22Linked+pull+requests%22%2C%22Title%22%2C%22Assignees%22%2C%22Status%22%2C%22Sub-issues+progress%22%2C415268482%2C415268484%2C420712700%2C420713548%5D)

# Getting Started (Clone, Build, Test, Run)

Clone BestBefore's repository by running `git clone <link>`, where link is obtained by clicking code at the top of this repository, and copying the HTTPS web clone link.

## Prerequisites:

- Node.js 22+ (CI uses 22) and npm.

- `npm install` (CI uses `npm ci`)

## Environment

Copy `.env.example` to `.env.local` and fill in your secrets. Instructions to how to obtain such secrets are documented in the `.env.example` file. 

`.env.example` has the database url secret prefilled with a throwaway test database for ease of use if preferred.

**Note:** Some features will not work without the right variables or secrets.

| Variable | Needed for |
|---|---|
| `DATABASE_URL` | Neon Postgres: the server, `db:*` scripts |
| `NEON_AUTH_URL`, `VITE_NEON_AUTH_URL` | Login (server / client) |
| `PORT` | API port (defaults to 3000; Vite proxies `/api` to `localhost:3000`) |
| `VITE_DISABLE_AUTH` | Optional dev-only login bypass (`true`); ignored in Vercel production |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Optional: AI Vision and the Gemini expiry fallback |
| `GO_UPC_API_KEY` | Optional: extra barcode source (Open Food Facts and UPCitemdb work without it) |
| `EXPIRY_AI_FALLBACK_ENABLED` | Optional: set `false` to turn off the Gemini expiry fallback |

## Database (first time/after schema change)

**Note:** Not needed if using prefilled throwaway database url in `.env.example`

`npm run db:migrate`: Apply drizzle migrations to DATABASE_URL

`npm run db:seed`: Optional, mock inventory for dev user (replaces that dev user's items)

## Run (dev)

`npm run dev`: Vite client + server API, side by side

Or run them separately with `npm run dev:client` and `npm run dev:server`

## Test:

`npm test`: Client and server tests in a single run

Tests do not need real secrets because the server test config uses placeholder values. 

**If `VITE_DISABLE_AUTH=true` is in your .env.local file, 3 server auth tests fail**. Change to `VITE_DISABLE_AUTH=FALSE` before running tests.

## Full CI Check and Build (same order as `.github/workflows/ci.yml`)

`npm run lint`

`npm run typecheck`

`npm run test:coverage`

`npm run build`: client to dist/, server via server/tsconfig.json

# Beta Features

- **Accounts:** Register, log in and log out through Neon Auth. Every inventory route needs a signed-in user, and each user sees only their own items (auth environment flag true uses a test dev user without needed log in).

- **Barcode Scanning:** Scan a product with the device camera. BestBefore checks its shared product catalog first, then Open Food Facts, UPCitemdb and, if a key is set, Go-UPC. It prefills the name, brand and barcode in an add item form.

- **AI Vision:** Take a photo of an item that has no barcode. Gemini prefills the name, plus brand, category and quantity when it is confident, and the photo is kept on user's item.

- **Best-before Suggestions:** The app suggests a date from the USDA FoodKeeper shelf-life data. Gemini can optionally help pick the FoodKeeper match. A suggested date is only used when you press "Use <date>"; otherwise user sets the date themselves.

- **Manual Add and Edit:** Add items manually via an add item form, and edit name, brand, category, quantity and dates from the item detail page.

- **Expiry Views:** Home previews the items expiring soonest and My Items lists everything, soonest first. Expired items show in red with "Expired on <date>".

- **Deleting Items:** Delete items via option inside specific item detail pages or via removal option on an expired item's card in My Items.

### Known Limitations

- Forgot password is a placeholder and sends no email.

- AI features need `GEMINI_API_KEY`. They are rate limited per user and use paid Gemini quota.

- Suggested dates are estimates. Always check the date printed on the package.
