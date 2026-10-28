import { desc, eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod/v4'
import { requireAdmin, toPublicUser } from '../auth'
import { APP_SCHEMA, getDb, getPool } from '../db'
import { integrationStatus } from '../integrations'
import { emitUsersChanged } from '../realtime'
import { files, invites, items, ledgerEntries, orderItems, orders, products, users, type User } from '../schema'
import { grossMargin, marginPercent } from '../math'

type AuthEnv = {
  Variables: {
    user: User
  }
}

export type AdminUserPatch = z.infer<typeof AdminUserPatch>
export const AdminUserPatch = z.object({
  role: z.enum(['owner', 'admin', 'member']).optional(),
  disabled: z.boolean().optional(),
})

export type InviteInput = z.infer<typeof InviteInput>
export const InviteInput = z.object({
  email: z.email(),
  role: z.enum(['admin', 'member']).default('member'),
})

export const adminRouter = new Hono<AuthEnv>()

adminRouter.use('*', requireAdmin)

adminRouter.get('/users', async (c) => {
  const db = getDb()
  const rows = await db.select().from(users)
  return c.json({ users: rows.map(toPublicUser) })
})

adminRouter.patch('/users/:id', async (c) => {
  const parsed = AdminUserPatch.safeParse(await c.req.json())
  if (!parsed.success) {
    throw new HTTPException(400, { message: 'Invalid user update' })
  }

  const db = getDb()
  const [user] = await db
    .update(users)
    .set(parsed.data)
    .where(eq(users.id, c.req.param('id')))
    .returning()

  if (!user) {
    throw new HTTPException(404, { message: 'User not found' })
  }

  emitUsersChanged({ action: 'updated', userId: user.id, user: toPublicUser(user) })
  return c.json({ user: toPublicUser(user) })
})

adminRouter.get('/items', async (c) => {
  const db = getDb()
  const rows = await db.select().from(items)
  return c.json({ items: rows })
})

adminRouter.get('/invites', async (c) => {
  const db = getDb()
  const rows = await db.select().from(invites).orderBy(desc(invites.createdAt))
  return c.json({ invites: rows })
})

adminRouter.post('/invites', async (c) => {
  const parsed = InviteInput.safeParse(await c.req.json())
  if (!parsed.success) {
    throw new HTTPException(400, { message: 'Invalid invite payload' })
  }

  const actor = c.get('user')
  const token = crypto.randomUUID()
  const db = getDb()
  const [invite] = await db.insert(invites).values({
    id: crypto.randomUUID(),
    email: parsed.data.email.toLowerCase(),
    role: parsed.data.role,
    token,
    invitedBy: actor.id,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  }).returning()

  const appUrl = process.env.APP_URL || 'http://localhost:5174'
  return c.json({
    invite,
    url: `${appUrl}/signup?invite=${token}`,
  }, 201)
})

adminRouter.get('/schema', async (c) => {
  const pool = getPool()
  const result = await pool.query(
    `SELECT c.relname AS name, c.reltuples::bigint AS estimate
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = $1 AND c.relkind = 'r'
     ORDER BY c.relname`,
    [APP_SCHEMA]
  )

  const counts: Record<string, number> = {}
  for (const row of result.rows as Array<{ name: string }>) {
    const counted = await pool.query(`SELECT COUNT(*)::int AS count FROM "${APP_SCHEMA}"."${row.name}"`)
    counts[row.name] = counted.rows[0]?.count ?? 0
  }

  return c.json({ schema: APP_SCHEMA, tables: counts })
})

adminRouter.get('/integrations', (c) => c.json({ integrations: integrationStatus() }))

adminRouter.get('/suggested-tables', (c) => {
  const kind = c.req.query('kind') === 'saas' ? 'saas' : 'shop'
  const shop = ['products', 'orders', 'order_items', 'payments', 'ledger_entries']
  const saas = ['users', 'sessions', 'subscriptions', 'usage_events', 'ledger_entries']
  return c.json({ kind, tables: kind === 'saas' ? saas : shop })
})

function summarizeOrders(
  paidRows: Array<{ id: string; total: number }>,
  lines: Array<{ orderId: string; productId: string; qty: number; cost: number; price: number }>
) {
  const orderIds = new Set(paidRows.map((order) => order.id))
  const revenue = paidRows.reduce((sum, order) => sum + order.total, 0)
  const periodLines = lines.filter((line) => orderIds.has(line.orderId))
  const cogs = periodLines.reduce((sum, line) => sum + line.cost * line.qty, 0)
  const top = new Map<string, { productId: string; qty: number; revenue: number }>()
  for (const line of periodLines) {
    const current = top.get(line.productId) || { productId: line.productId, qty: 0, revenue: 0 }
    current.qty += line.qty
    current.revenue += line.price * line.qty
    top.set(line.productId, current)
  }
  return {
    revenue,
    cogs,
    margin: grossMargin(revenue, cogs),
    marginPercent: marginPercent(revenue, cogs),
    paidOrders: paidRows.length,
    top,
  }
}

adminRouter.get('/analytics', async (c) => {
  const db = getDb()
  const paid = await db.select().from(orders).where(sql`${orders.status} = 'paid'`)
  const lines = await db.select().from(orderItems)
  const now = Date.now()
  const since = (ms: number) => paid.filter((order) => order.createdAt.getTime() >= now - ms)
  const all = summarizeOrders(paid, lines)
  const today = summarizeOrders(since(24 * 60 * 60 * 1000), lines)
  const week = summarizeOrders(since(7 * 24 * 60 * 60 * 1000), lines)
  const month = summarizeOrders(since(30 * 24 * 60 * 60 * 1000), lines)
  const catalog = await db.select().from(products)
  const topProducts = [...all.top.values()]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5)
    .map((row) => ({
      ...row,
      name: catalog.find((product) => product.id === row.productId)?.name || row.productId,
    }))

  return c.json({
    revenue: all.revenue,
    cogs: all.cogs,
    margin: all.margin,
    marginPercent: all.marginPercent,
    paidOrders: all.paidOrders,
    today: { revenue: today.revenue, margin: today.margin, marginPercent: today.marginPercent, paidOrders: today.paidOrders },
    week: { revenue: week.revenue, margin: week.margin, marginPercent: week.marginPercent, paidOrders: week.paidOrders },
    month: { revenue: month.revenue, margin: month.margin, marginPercent: month.marginPercent, paidOrders: month.paidOrders },
    topProducts,
    ledgerCount: (await db.select().from(ledgerEntries)).length,
  })
})

adminRouter.get('/files', async (c) => {
  const db = getDb()
  const rows = await db.select().from(files)
  return c.json({ files: rows })
})
