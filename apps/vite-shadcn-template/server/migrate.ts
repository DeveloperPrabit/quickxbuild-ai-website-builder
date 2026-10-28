import bcrypt from 'bcryptjs'
import { APP_SCHEMA, DATABASE_URL, getPool, sanitizeAppSchema } from './db'

const DEV_ADMIN_EMAIL = 'admin@admin.com'
const DEV_ADMIN_PASSWORD = 'admin123'

export async function migrateAppSchema(schemaName = APP_SCHEMA): Promise<void> {
  const schema = sanitizeAppSchema(schemaName)
  const pool = getPool()
  const client = await pool.connect()

  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
    await client.query(`SET search_path TO "${schema}", public`)
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        disabled BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await client.query(`UPDATE users SET role = 'member' WHERE role = 'user'`)
    await client.query(`ALTER TABLE users ALTER COLUMN role SET DEFAULT 'member'`)
    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL
      )
    `)
    await client.query(`
      CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await client.query(`
      CREATE TABLE IF NOT EXISTS invites (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        token TEXT NOT NULL UNIQUE,
        invited_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await client.query(`
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        mime TEXT NOT NULL,
        size INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sku TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        cost INTEGER NOT NULL DEFAULT 0,
        price INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'usd',
        stock INTEGER NOT NULL DEFAULT 0,
        image_file_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'unpaid',
        currency TEXT NOT NULL DEFAULT 'usd',
        subtotal INTEGER NOT NULL DEFAULT 0,
        tax INTEGER NOT NULL DEFAULT 0,
        discount INTEGER NOT NULL DEFAULT 0,
        total INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await client.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL REFERENCES products(id),
        qty INTEGER NOT NULL,
        cost INTEGER NOT NULL,
        price INTEGER NOT NULL
      )
    `)
    await client.query(`
      CREATE TABLE IF NOT EXISTS ledger_entries (
        id TEXT PRIMARY KEY,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        debit INTEGER NOT NULL DEFAULT 0,
        credit INTEGER NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'usd',
        note TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await client.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        amount INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'usd',
        external_id TEXT,
        description TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await client.query(`
      CREATE TABLE IF NOT EXISTS password_resets (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL
      )
    `)

    // SUPER ADMIN SETUP
    const existingAdmin = await client.query(
      'SELECT id FROM users WHERE email = $1 LIMIT 1',
      [DEV_ADMIN_EMAIL]
    )
    if (existingAdmin.rowCount === 0) {
      const passwordHash = await bcrypt.hash(DEV_ADMIN_PASSWORD, 10)
      await client.query(
        `INSERT INTO users (id, email, password_hash, name, role)
         VALUES ($1, $2, $3, $4, $5)`,
        [crypto.randomUUID(), DEV_ADMIN_EMAIL, passwordHash, 'Super Admin', 'owner']
      )
    } else {
      await client.query(
        `UPDATE users SET role = 'owner' WHERE email = $1 AND role IN ('admin', 'user', 'member')`,
        [DEV_ADMIN_EMAIL]
      )
    }
  } finally {
    client.release()
  }
}

if (import.meta.main) {
  migrateAppSchema()
    .then(() => {
      console.log(`Migrated schema ${APP_SCHEMA} on ${DATABASE_URL}`)
      process.exit(0)
    })
    .catch((error) => {
      console.error('Migration failed', error)
      process.exit(1)
    })
}
