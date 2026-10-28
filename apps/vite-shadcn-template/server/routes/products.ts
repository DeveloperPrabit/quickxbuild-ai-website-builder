import { desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod/v4'
import { requireAdmin, requireAuth } from '../auth'
import { getDb } from '../db'
import { emitProductsChanged } from '../realtime'
import { products } from '../schema'

export type ProductInput = z.infer<typeof ProductInput>
export const ProductInput = z.object({
  name: z.string().min(1).max(120),
  sku: z.string().min(1).max(64),
  description: z.string().max(2000).optional().default(''),
  cost: z.int().min(0),
  price: z.int().min(0),
  currency: z.string().min(3).max(8).optional().default('usd'),
  stock: z.int().min(0).optional().default(0),
  imageFileId: z.string().optional(),
})

export const productsRouter = new Hono()

productsRouter.get('/', async (c) => {
  const db = getDb()
  const rows = await db.select().from(products).orderBy(desc(products.createdAt))
  return c.json({ products: rows })
})

productsRouter.get('/:id', async (c) => {
  const db = getDb()
  const [product] = await db.select().from(products).where(eq(products.id, c.req.param('id'))).limit(1)
  if (!product) {
    throw new HTTPException(404, { message: 'Product not found' })
  }
  return c.json({ product })
})

productsRouter.post('/', requireAuth, requireAdmin, async (c) => {
  const parsed = ProductInput.safeParse(await c.req.json())
  if (!parsed.success) {
    throw new HTTPException(400, { message: 'Invalid product. Use integer minor units for cost and price.' })
  }
  const db = getDb()
  const [product] = await db.insert(products).values({
    id: crypto.randomUUID(),
    ...parsed.data,
  }).returning()
  emitProductsChanged({ action: 'created', productId: product.id, product })
  return c.json({ product }, 201)
})

productsRouter.patch('/:id', requireAuth, requireAdmin, async (c) => {
  const parsed = ProductInput.partial().safeParse(await c.req.json())
  if (!parsed.success) {
    throw new HTTPException(400, { message: 'Invalid product update' })
  }
  const db = getDb()
  const [product] = await db.update(products).set({
    ...parsed.data,
    updatedAt: new Date(),
  }).where(eq(products.id, c.req.param('id'))).returning()
  if (!product) {
    throw new HTTPException(404, { message: 'Product not found' })
  }
  emitProductsChanged({ action: 'updated', productId: product.id, product })
  return c.json({ product })
})
