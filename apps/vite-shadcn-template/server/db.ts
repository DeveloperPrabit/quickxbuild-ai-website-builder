import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

export function sanitizeAppSchema(raw: string | undefined): string {
  const value = (raw || 'app_local').trim()
  const normalized = value.startsWith('app_') ? value : `app_${value}`
  const safe = normalized.replace(/[^a-zA-Z0-9_]/g, '')
  if (!safe.startsWith('app_') || safe.length < 5) {
    return 'app_local'
  }
  return safe
}

export const APP_SCHEMA = sanitizeAppSchema(process.env.APP_SCHEMA)

/**
 * Neon (or platform-injected) Postgres URL for this generated app.
 * Never fall back to localhost — QuickXBuild injects DATABASE_URL + APP_SCHEMA in preview/publish.
 */
export const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || ''

let pool: Pool | undefined

export function getPool(): Pool {
  if (!DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is not set. QuickXBuild must inject Neon Postgres for this project (APP_SCHEMA isolation).'
    )
  }
  if (!pool) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      options: `-c search_path=${APP_SCHEMA},public`,
      ssl: DATABASE_URL.includes('sslmode=require') || DATABASE_URL.includes('neon.tech')
        ? { rejectUnauthorized: false }
        : undefined,
    })
  }
  return pool
}

export function getDb() {
  return drizzle(getPool(), { schema })
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = undefined
  }
}
