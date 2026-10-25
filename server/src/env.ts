import { config } from 'dotenv'

// Local dev reads .env.local first, then .env. On Vercel the files don't exist and
// variables come from the project settings.
config({ path: ['.env.local', '.env'], quiet: true })
