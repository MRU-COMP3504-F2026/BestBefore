// Local-dev bypass: set VITE_DISABLE_AUTH=true in .env.local to skip login entirely.
// Only honoured by the Vite dev server; production builds always have auth on.
export const AUTH_DISABLED = import.meta.env.DEV && import.meta.env.VITE_DISABLE_AUTH === 'true'

export const DEV_USER = {
  id: 'dev-user',
  email: 'dev@bestbefore.local',
  name: 'Dev User',
}
