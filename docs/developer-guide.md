# BestBefore Developer Guide

Use the README quick start for everyday setup. This guide adds the repository map, test conventions and release build details. Run commands from the repository root.

## Get the source

Install Git, Node.js 22+ and npm. CI uses Node 22\.

```sh
git clone https://github.com/MRU-COMP3504-F2026/BestBefore.git
cd BestBefore
git switch dev
npm ci
```

Use `dev` for development, or `main` to work from the main branch. The README uses `npm install`; `npm ci` uses the committed lockfile and matches CI. There is one root npm package for both client and server. No additional source repositories or Git submodules are declared.

## Find the files

| Location | Contents |
| :---- | :---- |
| `src/` | React client: `pages/`, `components/`, `layouts/`, `router/`, `lib/` and `styles/` |
| `server/src/` | Express API, authentication, database schema, food lookup and inventory code |
| `api/index.ts` | Express entrypoint for Vercel |
| `src/test/` | Most client tests, setup and shared fixtures; some tests also sit beside their source |
| `server/src/test/` | Server tests, including route and in-memory database tests |
| `testscripts/` | Barcode provider/normalizer helpers, manual diagnostics and PWA checks |
| `expiry-tests/` | Expiry engine code and separate experiment/check scripts |
| `expiry-tests/foodkeeper.json` | Committed FoodKeeper dataset used by the engine |
| `expiry-tests/fixtures/`, `expiry-tests/results/` | Test inputs and saved experiment results |
| `drizzle/` | SQL migrations and metadata; schema source is `server/src/db/schema.ts` |
| `public/` | Static assets, PWA icons, manifest and service worker |
| `docs/`, `reports/` | Feature documentation and dated progress reports |
| `.github/workflows/` | CI and branch-policy checks |

## Set up and run

Copy `.env.example` to `.env.local` and follow the instructions in that example and the README environment section.

Real database access uses `DATABASE_URL`. Real login uses `NEON_AUTH_URL` and `VITE_NEON_AUTH_URL` for the same Neon branch as the database. See authentication setup for details. Keep secrets out of commits; `VITE_*` variables are exposed to the browser.

Gemini features require `GEMINI_API_KEY`; Go-UPC optionally uses `GO_UPC_API_KEY`. Open Food Facts and UPCitemdb work without keys but still need a connection. See the README for the full variable table and scan/expiry documentation for AI fallback settings.

For database setup, follow the README database section. `npm run db:migrate` changes the database selected by `DATABASE_URL`; use the intended development database. Seeding is optional and replaces the development user's inventory. Neither migration nor seeding is needed for the automated tests below.

```sh
npm run dev
```

This starts Vite and the Express API together. To run them separately, use `npm run dev:client` and `npm run dev:server` in separate terminals. The API defaults to port 3000, and Vite proxies `/api` to `localhost:3000`. If changing `PORT`, update the proxy target accordingly.

## Build both components

```sh
npm run build
```

This runs both component builds in order:

| Command | Build |
| :---- | :---- |
| `npm run build:client` | TypeScript checks and Vite production build into `dist/` |
| `npm run build:server` | TypeScript compilation using `server/tsconfig.json`, into `server/dist/` |

The server compiler preserves paths relative to the repository root, so the server entry is emitted under `server/dist/server/src/`. `npm run preview` previews the built client; it does not start the API or reproduce Vercel's API routing.

## Run tests

Install dev dependencies with `npm ci`. The regular suites use committed fixtures and FoodKeeper data, mocked services and, in some server tests, PGlite in memory with the migrations. They do not need a live Neon database or real API secrets. The server test configuration supplies placeholder database/auth values.

As the README notes, set `VITE_DISABLE_AUTH=FALSE` in `.env.local` before testing if you enabled the development bypass; leaving it enabled causes auth-test failures.

```sh
npm test
```

This runs both client and server suites once. Other commands are:

| Command | Purpose |
| :---- | :---- |
| `npm run test:client` | Client suite once |
| `npm run test:server` | Server suite once |
| `npm run test:coverage` | Both suites with V8 text/HTML coverage in `coverage/client/` and `coverage/server/` |

The component test scripts without `--run` support Vitest's interactive/watch use.

### Additional checks

The PWA changes add `npm run test:pwa`, a separate Node test suite. Run it after `npm run build` so its built-asset check runs; that check skips when `dist/index.html` is absent. PWA checks are not included in `npm test` or CI.&nbsp;

For the separate mocked Gemini expiry fallback check:

```sh
npx tsx expiry-tests/test-ai-fallback.ts
```

This custom harness uses fixtures and a fake Gemini client, with a nonzero exit on failure. It is not part of `npm test`. Other expiry strategy scripts can write files under `expiry-tests/results/`; review those changes before committing.

Manual diagnostics such as `npx tsx testscripts/all-sources.ts` call external barcode providers and prompt for a barcode; Go-UPC requires its key. Live Gemini experiments require a key and may consume paid quota. These tools are separate from the offline automated suites.

## Add a new test

| Area | File naming and harness |
| :---- | :---- |
| Client | `src/**/*.test.ts` or `.test.tsx`; usually `src/test/FeatureName.test.tsx`. Vitest with jsdom, Testing Library and jest-dom setup in `src/test/setup.ts`. Colocated tests also work. |
| Server | `server/src/**/*.test.ts`; usually `server/src/test/featureName.test.ts`. Vitest in Node, with Supertest for Express routes. |
| PWA | `testscripts/pwa.test.mjs`, using Node's `node:test` and assertions. |

Follow the naming style of nearby files and use `describe`, `it` and `expect` to describe behavior. `src/test/Button.test.tsx` shows rendering and role/name queries. `src/test/inventoryFixtures.tsx` provides shared items and `renderWithQuery` for components needing React Query.

For server routes, follow `server/src/test/inventory.test.ts`: import the Express app, send requests through Supertest and stub database calls. For actual SQL behavior, `server/src/test/items.test.ts` demonstrates isolated PGlite and migrations. Mock network/auth/AI calls, use synthetic fixtures, and restore spies, timers and environment overrides after tests. Cover the changed behavior and relevant error cases without using real accounts or production data.

Run a focused test by passing its path:

```sh
npm run test:client -- --run src/test/Button.test.tsx
npm run test:server -- --run server/src/test/inventory.test.ts
```

Then run the full suites and checks below. Files named `test-*.ts` under `expiry-tests/` are separate scripts, not automatically discovered by Vitest; add regular expiry regressions under `server/src/test/` when they should run in CI.

## Release build and existing branch flow

The existing CI workflow installs with `npm ci`, then runs these commands in the same order shown in the README:

```sh
npm run lint
npm run typecheck
npm run test:coverage
npm run build
```

This checks both components and creates the production build outputs described above. CI runs for pushes and PRs involving `dev` and `main`. The branch-policy workflow accepts `feat/`, `fix/`, `docs/`, `chore/`, `refactor/` or `test/` branches into `dev`, and only `dev` into `main`.

For PWA releases, also run `npm run test:pwa` after building. Existing PWA release checks cover Android Chrome/iOS Safari installation over HTTPS, icons and headers, sign-in and user switching, inventory editing, camera scanning, offline behavior and updates without forced reload. Follow that checklist for the manual device checks. When changing worker behavior, update the version constant in `public/sw.js`, as that file and the PWA guide specify.

Vercel configuration is in `vercel.json`, with the API exported by `api/index.ts` and FoodKeeper JSON included in the function.&nbsp;

The package version is currently `0.0.0`. An application version-bump/tagging procedure and a complete deployment/promotion procedure are not documented in the inspected repository; no separate release script/workflow is defined. The commands above describe the existing build/check process, not an additional publishing procedure.