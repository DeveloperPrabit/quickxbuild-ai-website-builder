import { desc, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod/v4'
import { requireAuth } from '../auth'
import { getDb } from '../db'
import { writeLedger } from '../ledger'
import { orderCogs, orderRevenue } from '../math'
import { emitOrdersChanged } from '../realtime'
import { orderItems, orders, products, type User } from '../schema'

type AuthEnv = {
  Variables: {
    user: User
  }
}

export type OrderInput = z.infer<typeof OrderInput>
export const OrderInput = z.object({
  tax: z.int().min(0).optional().default(0),
  discount: z.int().min(0).optional().default(0),
  items: z.array(z.object({
    productId: z.string(),
    qty: z.int().min(1),
  })).min(1),
})

export const ordersRouter = new Hono<AuthEnv>()

ordersRouter.use('*', requireAuth)

ordersRouter.get('/', async (c) => {
  const user = c.get('user')
  const db = getDb()
  const rows = await db.select().from(orders).where(eq(orders.userId, user.id)).orderBy(desc(orders.createdAt))
  return c.json({ orders: rows })
})

ordersRouter.post('/', async (c) => {
  const parsed = OrderInput.safeParse(await c.req.json())
  if (!parsed.success) {
    throw new HTTPException(400, { message: 'Invalid order. qty/tax/discount must be integers.' })
  }

  const db = getDb()
  const ids = parsed.data.items.map((item) => item.productId)
  const catalog = await db.select().from(products).where(inArray(products.id, ids))
  if (catalog.length !== ids.length) {
    throw new HTTPException(400, { message: 'Unknown product in order' })
  }

  const lines = parsed.data.items.map((item) => {
    const product = catalog.find((row) => row.id === item.productId)
    if (!product) {
      throw new HTTPException(400, { message: 'Unknown product in order' })
    }
    if (product.stock < item.qty) {
      throw new HTTPException(400, { message: `Insufficient stock for ${product.sku}` })
    }
    return { product, qty: item.qty, price: product.price, cost: product.cost }
  })

  const currency = lines[0]?.product.currency || 'usd'
  const subtotal = orderRevenue(lines.map((line) => ({ price: line.price, cost: line.cost, qty: line.qty })), 0, 0)
  const total = orderRevenue(
    lines.map((line) => ({ price: line.price, cost: line.cost, qty: line.qty })),
    parsed.data.tax,
    parsed.data.discount
  )
  const cogs = orderCogs(lines.map((line) => ({ price: line.price, cost: line.cost, qty: line.qty })))

  const [order] = await db.insert(orders).values({
    id: crypto.randomUUID(),
    userId: c.get('user').id,
    status: 'unpaid',
    currency,
    subtotal,
    tax: parsed.data.tax,
    discount: parsed.data.discount,
    total,
  }).returning()

  await db.insert(orderItems).values(lines.map((line) => ({
    id: crypto.randomUUID(),
    orderId: order.id,
    productId: line.product.id,
    qty: line.qty,
    cost: line.cost,
    price: line.price,
  })))

  for (const line of lines) {
    await db.update(products).set({
      stock: line.product.stock - line.qty,
      updatedAt: new Date(),
    }).where(eq(products.id, line.product.id))
  }

  await writeLedger({
    sourceType: 'order',
    sourceId: order.id,
    debit: cogs,
    credit: total,
    currency,
    note: 'COD/unpaid order created',
  })
  emitOrdersChanged({ action: 'created', orderId: order.id, order })
  return c.json({ order }, 201)
})
