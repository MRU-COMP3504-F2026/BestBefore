# Installing BestBefore

Serve the production build over HTTPS at the origin root. Vercel provides HTTPS;
other hosts must provide TLS, serve public files before the SPA fallback, serve
`/manifest.webmanifest` as `application/manifest+json`, and serve `/sw.js` as
JavaScript with `Cache-Control: no-cache, no-store, must-revalidate`. Localhost
is a secure-context exception for development; ordinary phone LAN HTTP is not.
The worker is registered only in production builds. No extra packages are needed.

Android Chrome: use the install button when Chrome offers installation, or its
menu's Install app / Add to Home screen. iOS/iPadOS Safari: Share > Add to Home
Screen > Add (enable Open as Web App if offered). The expandable instructions
below the app remain available when the browser does not expose an install event.
Installed windows hide this guidance. Installation is never prompted automatically.

The service worker stores nothing. Inventory, API responses, auth responses,
credentials, HTML and JS are never placed in a service worker cache. Offline
launch at `/` shows a static connection message; the app requires a connection.
Auth URLs, query strings, other navigations and API requests pass through untouched.
Updates use the normal waiting-worker lifecycle: close all existing app windows
and reopen to activate a new worker. There is no forced reload or skipWaiting.
Change the worker version comment/constant when worker behavior changes.

Validation: `npm run typecheck`, `npm run lint`, `npm run build`,
`npm test`, then `npm run test:pwa`. The PWA check validates built assets when
`dist` exists; that one check is skipped before a build.

Before release, on actual Android Chrome and iOS Safari over HTTPS:
- Check manifest and worker MIME types, scope, headers and icon appearance.
- Install from browser UI; launch from home screen in standalone mode.
- Sign in, refresh, follow auth redirects, edit inventory, sign out and sign in
  as another user. Check that no previous user's inventory appears.
- Inspect Cache Storage: the worker creates no caches. Check API/auth traffic
  remains network-only and offline launch displays the connection message.
- Deploy a test update in a separate authorized test environment, keep an edit
  open, confirm no forced reload, close every app tab/window and reopen.
- Check icon masking on Android, touch icon on iOS, safe-area layout, camera
  permission/barcode scanning, native prompt dismissal and manual instructions.
