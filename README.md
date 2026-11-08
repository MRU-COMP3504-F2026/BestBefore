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
