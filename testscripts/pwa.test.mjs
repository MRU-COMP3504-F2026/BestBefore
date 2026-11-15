import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

const read = (file) => readFileSync(new URL('../' + file, import.meta.url))
test('manifest, Apple metadata and PNG dimensions support phone installation', () => {
  const manifest = JSON.parse(read('public/manifest.webmanifest'))
  assert.equal(manifest.start_url, '/')
  assert.equal(manifest.scope, '/')
  assert.equal(manifest.id, '/')
  assert.equal(manifest.display, 'standalone')
  assert.equal(manifest.theme_color, '#f6f4ee')
  for (const icon of [...manifest.icons, { src: '/icons/apple-touch-icon.png', sizes: '180x180' }]) {
    const png = read('public' + icon.src)
    assert.equal(png.subarray(1, 4).toString(), 'PNG')
    const [width, height] = icon.sizes.split('x').map(Number)
    assert.equal(png.readUInt32BE(16), width)
    assert.equal(png.readUInt32BE(20), height)
  }
  assert(manifest.icons.some((icon) => icon.purpose === 'maskable'))
  const html = read('index.html').toString()
  assert.match(html, /rel="manifest" href="\/manifest.webmanifest"/)
  assert.match(html, /rel="apple-touch-icon"/)
  assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/)
})
function worker(fetchImpl) {
  const handlers = {}
  vm.runInNewContext(read('public/sw.js').toString(), {
    URL, Response, fetch: fetchImpl,
    self: { location: { origin: 'https://bestbefore.example' }, addEventListener: (name, fn) => { handlers[name] = fn } },
    // No cache API, storage API, skipWaiting or clients.claim provided:
    // accessing any of them fails this test.
  })
  handlers.install()
  return handlers.fetch
}
test('worker never intercepts API, credentials, auth callbacks, assets or mutations', () => {
  const handle = worker(() => { throw Error('Unexpected fetch') })
  for (const [path, method, mode] of [
    ['/api/inventory', 'GET', 'cors'], ['/api/auth/session', 'GET', 'navigate'],
    ['/auth/callback?code=secret', 'GET', 'navigate'], ['/?code=secret', 'GET', 'navigate'],
    ['/assets/app.js', 'GET', 'cors'], ['/', 'POST', 'navigate'],
    ['https://other.example/', 'GET', 'navigate'],
  ]) {
    handle({ request: { url: new URL(path, 'https://bestbefore.example').href, method, mode }, respondWith: () => assert.fail('intercepted private request') })
  }
})
test('launch navigation uses the original request and response without storing anything', async () => {
  const response = new Response('live app')
  const request = { url: 'https://bestbefore.example/', method: 'GET', mode: 'navigate' }
  const handle = worker(async (actual) => { assert.equal(actual, request); return response })
  let result
  handle({ request, respondWith: (value) => { result = value } })
  assert.equal(await result, response)
})
test('offline launch shows a no-store message without private data', async () => {
  const handle = worker(async () => { throw Error('offline') })
  let result
  handle({ request: { url: 'https://bestbefore.example/', method: 'GET', mode: 'navigate' }, respondWith: (value) => { result = value } })
  const response = await result
  assert.equal(response.status, 503)
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  assert.match(await response.text(), /You are offline/)
})
test('hosting config keeps worker fresh and preserves API routing', () => {
  const config = JSON.parse(read('vercel.json'))
  assert.equal(config.rewrites[0].source, '/api/:path*')
  assert.equal(config.rewrites[0].destination, '/api')
  const headers = config.headers.find((rule) => rule.source === '/sw.js').headers
  assert(headers.some((header) => header.key === 'Cache-Control' && header.value.includes('no-store')))
})
test('production build ships the exact manifest, worker and icons', { skip: !existsSync(new URL('../dist/index.html', import.meta.url)) }, () => {
  for (const path of ['manifest.webmanifest', 'sw.js', 'icons/app-192.png', 'icons/app-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png']) {
    assert.deepEqual(read('dist/' + path), read('public/' + path))
  }
  assert.match(read('dist/index.html').toString(), /rel="manifest"/)
})
