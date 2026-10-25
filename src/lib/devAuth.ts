// Dev/preview bypass: set VITE_DISABLE_AUTH=true (.env.local locally, Vercel's Preview env for
// previews) to skip login entirely. Never honoured in Vercel production builds.
export const AUTH_DISABLED =
  import.meta.env.VITE_DISABLE_AUTH === 'true' && import.meta.env.VITE_VERCEL_ENV !== 'production'

export const DEV_USER = {
  id: 'dev-user',
  email: 'dev@bestbefore.local',
  name: 'Dev User',
}
