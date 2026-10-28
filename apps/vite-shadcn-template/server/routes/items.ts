import { and, desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod/v4'
import { requireAuth } from '../auth'
import { getDb } from '../db'
import { emitItemsChanged } from '../realtime'
import { items, type User } from '../schema'

type AuthEnv = {
  Variables: {
    user: User
  }
}

export type ItemInput = z.infer<typeof ItemInput>
export const ItemInput = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(4000).optional().default(''),
})

export const itemsRouter = new Hono<AuthEnv>()

itemsRouter.use('*', requireAuth)

itemsRouter.get('/', async (c) => {
  const user = c.get('user')
  const db = getDb()
  const rows = await db
    .select()
    .from(items)
    .where(eq(items.userId, user.id))
    .orderBy(desc(items.createdAt))
  return c.json({ items: rows })
})

itemsRouter.post('/', async (c) => {
  const user = c.get('user')
  const parsed = ItemInput.safeParse(await c.req.json())
  if (!parsed.success) {
    throw new HTTPException(400, { message: 'Invalid item payload' })
  }

  const db = getDb()
  const [item] = await db.insert(items).values({
    id: crypto.randomUUID(),
    userId: user.id,
    title: parsed.data.title,
    body: parsed.data.body,
  }).returning()

  emitItemsChanged({ action: 'created', itemId: item.id, item })
  return c.json({ item }, 201)
})

itemsRouter.patch('/:id', async (c) => {
  const user = c.get('user')
  const parsed = ItemInput.partial().safeParse(await c.req.json())
  if (!parsed.success) {
    throw new HTTPException(400, { message: 'Invalid item payload' })
  }

  const db = getDb()
  const [item] = await db
    .update(items)
    .set({
      ...parsed.data,
      updatedAt: new Date(),
    })
    .where(and(eq(items.id, c.req.param('id')), eq(items.userId, user.id)))
    .returning()

  if (!item) {
    throw new HTTPException(404, { message: 'Item not found' })
  }

  emitItemsChanged({ action: 'updated', itemId: item.id, item })
  return c.json({ item })
})

itemsRouter.delete('/:id', async (c) => {
  const user = c.get('user')
  const db = getDb()
  const [item] = await db
    .delete(items)
    .where(and(eq(items.id, c.req.param('id')), eq(items.userId, user.id)))
    .returning()

  if (!item) {
    throw new HTTPException(404, { message: 'Item not found' })
  }

  emitItemsChanged({ action: 'deleted', itemId: item.id, item })
  return c.json({ ok: true })
})
