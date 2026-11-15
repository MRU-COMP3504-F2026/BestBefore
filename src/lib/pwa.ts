/** Register only in production over a secure context. Keep the browser's
 * waiting-worker lifecycle so updates cannot interrupt edits or authentication. */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !window.isSecureContext || !('serviceWorker' in navigator)) return
  const register = () => {
    void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .catch((error: unknown) => console.warn('BestBefore install support unavailable:', error))
  }
  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register, { once: true })
}
