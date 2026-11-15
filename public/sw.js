/* No caches, credentials, API responses, or inventory are stored by this worker.
 * Updates wait for all existing app windows to close; never force a reload.
 * Bump this version when changing worker behavior. */
const VERSION = 'bestbefore-pwa-v1';
self.addEventListener('install', () => { void VERSION; });
// Only the launch URL gets an offline message. All other requests, including
// auth redirects, API calls and mutations, retain normal browser behavior.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || event.request.mode !== 'navigate' ||
      url.origin !== self.location.origin || url.pathname !== '/' || url.search) return;
  event.respondWith(fetch(event.request).catch(() => new Response(
    '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BestBefore offline</title><h1>You are offline</h1><p>Connect to the internet to use BestBefore. Your inventory requires a secure connection.</p><a href="/">Try again</a></html>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
  )));
});
