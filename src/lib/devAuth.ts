// Dev/preview bypass: set VITE_DISABLE_AUTH=true (.env.local locally, Vercel's Preview env for
// previews) to skip login entirely. Never honoured in Vercel production builds.
export const AUTH_DISABLED =
  import.meta.env.VITE_DISABLE_AUTH === 'true' && import.meta.env.VITE_VERCEL_ENV !== 'production'

// The real dev@devtest.ca account on the dev Neon branch, so auth-off and signed-in dev
// sessions share the same data.
export const DEV_USER = {
  id: '6b6d7eaa-7675-4b0a-8942-66ffeb0830a3',
  email: 'dev@devtest.ca',
  name: 'dev',
}
