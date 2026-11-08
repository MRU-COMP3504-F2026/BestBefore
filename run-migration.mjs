import { neon } from '@neondatabase/serverless'
import { readFileSync } from 'node:fs'

const sql = neon(process.env.DATABASE_URL)
const file = readFileSync('drizzle/0001_unknown_talkback.sql', 'utf8')
const statements = file.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean)

for (const s of statements) {
  console.log('Running:', s.slice(0, 60))
  await sql.query(s)
}
console.log('Done')