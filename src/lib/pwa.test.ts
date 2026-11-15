import { afterEach, expect, test, vi } from 'vitest'
import { registerServiceWorker } from './pwa'

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
test('does not register during development or insecure HTTP', () => {
  const register = vi.fn()
  vi.stubGlobal('navigator', { serviceWorker: { register } })
  vi.stubGlobal('isSecureContext', true)
  vi.stubEnv('PROD', false)
  registerServiceWorker()
  vi.stubEnv('PROD', true)
  vi.stubGlobal('isSecureContext', false)
  registerServiceWorker()
  expect(register).not.toHaveBeenCalled()
})
test('registers root scope with fresh worker scripts without forcing activation', async () => {
  const register = vi.fn().mockResolvedValue({})
  vi.stubGlobal('navigator', { serviceWorker: { register } })
  vi.stubGlobal('isSecureContext', true)
  vi.stubEnv('PROD', true)
  vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete')
  registerServiceWorker()
  expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/', updateViaCache: 'none' })
})
