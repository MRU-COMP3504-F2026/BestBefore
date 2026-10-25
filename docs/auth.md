# Authentication (Neon Auth)

BestBefore uses [Neon Auth](https://neon.com/docs/neon-auth), Neon's managed Better Auth.
There is no self-hosted auth server and no `BETTER_AUTH_SECRET`.

## How it fits together

```
Browser ──(sign up / sign in / sign out, session cookie)──► Neon Auth URL
   │
   └──(Authorization: Bearer <JWT>)──► Express /api/*  ──(verify via JWKS)──► Neon Auth URL
```

- **Frontend** (`src/lib/authClient.ts`): `createAuthClient(VITE_NEON_AUTH_URL)` with the React adapter.
  Login/Register/Profile call `signIn`, `signUp`, `signOut`. `RequireAuth` (`src/components/RequireAuth.tsx`)
  wraps every app route except `/login`, `/register`, `/forgot-password` and redirects signed-out users to `/login`.
- **API auth** (`server/src/auth/requireAuth.ts`): protected routes use the `requireAuth` middleware.
  `apiFetch` gets a short-lived (15 min) JWT from `authClient.token()` and sends it as a Bearer token.
  The server verifies it with `jose` against `${NEON_AUTH_URL}/.well-known/jwks.json`, checking that
  `iss` and `aud` equal the auth URL's origin. The verified user is in `res.locals.user` (`id` = Neon Auth user id).
  `GET /api/me` is the reference protected route.

### Why Bearer JWTs instead of cookies

Neon Auth's session cookie belongs to Neon's domain, not ours, so our Express API never sees it.
Neon documents JWTs for exactly this case (a backend that can't read the auth cookie). The trade-off is one
extra request to Neon per `apiFetch` call to get a token; add caching in `getApiToken` if that becomes a problem.

### Data separation

Neon Auth owns its tables in the `neon_auth` schema (users, sessions, accounts). Do not migrate them.
`drizzle.config.ts` sets `schemaFilter: ["public"]` so drizzle-kit ignores `neon_auth`.
App tables (households, inventory) live in `public` (`server/src/db/schema.ts`) and should reference users
by `neon_auth.user.id` only.

## Environment variables

| Variable | Where | Notes |
|---|---|---|
| `DATABASE_URL` | server, drizzle-kit | App data. Secret. |
| `NEON_AUTH_URL` | server | Auth URL, used for JWKS + issuer checks. |
| `VITE_NEON_AUTH_URL` | browser (build time) | Same value as `NEON_AUTH_URL`. Public, not a secret. |

Get the auth URL from **Neon Console → project → branch → Auth → Configuration → Auth URL**
(looks like `https://ep-xxxx.neonauth.<region>.aws.neon.tech/neondb/auth`). Each Neon branch has its own URL.

Not needed: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (self-hosted Better Auth only),
`NEON_AUTH_COOKIE_SECRET` (Neon's Next.js SDK only).

Locally, the server and drizzle-kit load `.env.local` then `.env` (`server/src/env.ts`); Vite reads `.env.local` itself.
On Vercel, set all three for Production and Preview. `VITE_NEON_AUTH_URL` is baked in at build time, so redeploy after changing it.

## Disabling auth for local dev

Add `VITE_DISABLE_AUTH=true` to `.env.local` (default in `.env.example` is `false`) and restart `npm run dev`.

- **Client** (`src/lib/devAuth.ts`): `RequireAuth` lets every route through, `useAuthSession()` returns a fixed
  dev user (`dev-user` / `dev@bestbefore.local`), and `signIn` / `signUp` / `signOut` succeed without calling Neon.
  Only the Vite dev server honours the flag; `vite build` output always has auth on.
- **Server** (`server/src/auth/devAuth.ts`): `requireAuth` skips JWT checks and sets `res.locals.user` to the
  same dev user. Ignored (with a warning) when `NODE_ENV=production` or `VERCEL` is set.

Neon credentials aren't needed with the flag on. Use `useAuthSession()` rather than `authClient.useSession()`
in components so the bypass applies.

## Sign-up rate limit (1 per IP per 24h)

Sign-ups go straight from the browser to Neon, so the limit is enforced by Neon Auth's blocking
`user.before_create` webhook, which calls `POST /api/webhooks/neon-auth` (`server/src/auth/webhook.ts`):

1. Verifies the detached EdDSA JWS signature (`X-Neon-Signature*` headers) against the same JWKS, using the raw body
   (the route is mounted before `express.json()`), and rejects timestamps older than 5 minutes.
2. For `user.before_create`, hashes `event_data.ip_address` (SHA-256) and checks `signup_attempts` for an entry in
   the last 24h. If one exists it responds `{ "allowed": false, "error_code": "SIGNUP_RATE_LIMITED" }`, otherwise it
   records one and allows. Limits are `SIGNUPS_PER_IP` / `SIGNUP_WINDOW_MS` in `server/src/auth/signupRateLimit.ts`.

Caveats:
- The webhook fires before Neon validates the sign-up, so a failed attempt (e.g. duplicate email) still uses the IP's slot.
- Neon **fails closed**: if the webhook is unreachable or errors, every sign-up is rejected.
- Neon only calls public HTTPS URLs, so it cannot reach `localhost`. Leave the webhook off on the dev branch
  (no limit locally), or point it at a tunnel (ngrok etc.) to test.

Configure it per branch: **Neon Console → Auth → Configuration → Webhooks**, URL
`https://<your-domain>/api/webhooks/neon-auth`, events: `user.before_create` only. Or with the CLI:

```sh
neon neon-auth config webhook update --enabled \
  --url https://<your-domain>/api/webhooks/neon-auth \
  --enabled-events user.before_create --timeout 5
```

If Vercel Deployment Protection is on for previews, Neon's webhook request will be blocked (and sign-ups will fail).
Either leave the webhook off for preview branches or use a protection bypass.

## Migrations

App tables only (auth tables are managed by Neon):

```sh
npm run db:generate   # writes SQL to drizzle/ from server/src/db/schema.ts
npm run db:migrate    # applies it to DATABASE_URL
```

`drizzle/0000_*.sql` creates `signup_attempts`. Run `db:migrate` against each Neon branch that serves the app
(dev, production, and any preview branch that has the webhook on).

## Neon console setup checklist

1. Enable Auth on the branch; make sure email/password sign-in is on. Email verification is not used yet.
2. **Trusted domains**: add the production domain. Localhost is allowed by default ("Allow Localhost").
3. **Preview deployments**: either use the Neon ↔ Vercel integration (it provisions a Neon branch with its own
   Auth URL and trusted domains per preview; make sure the preview's `VITE_NEON_AUTH_URL` / `NEON_AUTH_URL` point at
   that branch), or add preview domains by hand. Neon's docs disagree on whether wildcards like
   `https://*.vercel.app` are supported; check the console.
4. Configure the `user.before_create` webhook on production (see above).
5. Before launch: turn off "Allow Localhost" on production and set up custom SMTP (needed for password reset /
   verification emails later).

## Test account

`dev@devtest.ca` exists on the **dev** Neon branch for manual testing. The password is shared out of band;
never commit it.
