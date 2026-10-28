import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requireAuth } from '../auth'
import { getDb } from '../db'
import { emitFilesChanged } from '../realtime'
import { files, type User } from '../schema'

type AuthEnv = {
  Variables: {
    user: User
  }
}

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.resolve(process.cwd(), 'uploads')

export const filesRouter = new Hono<AuthEnv>()

filesRouter.use('*', requireAuth)

filesRouter.get('/', async (c) => {
  const user = c.get('user')
  const db = getDb()
  const rows = await db
    .select()
    .from(files)
    .where(eq(files.userId, user.id))
    .orderBy(desc(files.createdAt))
  return c.json({ files: rows })
})

filesRouter.post('/', async (c) => {
  const user = c.get('user')
  const body = await c.req.parseBody()
  const upload = body.file
  if (!(upload instanceof File)) {
    throw new HTTPException(400, { message: 'file field is required' })
  }

  const id = crypto.randomUUID()
  const safeName = upload.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const relativePath = `${id}-${safeName}`
  await mkdir(UPLOAD_DIR, { recursive: true })
  const destination = path.join(UPLOAD_DIR, relativePath)
  await writeFile(destination, Buffer.from(await upload.arrayBuffer()))

  const db = getDb()
  const [file] = await db.insert(files).values({
    id,
    userId: user.id,
    path: relativePath,
    mime: upload.type || 'application/octet-stream',
    size: upload.size,
  }).returning()

  emitFilesChanged({ action: 'created', fileId: file.id, file })
  return c.json({ file }, 201)
})

filesRouter.get('/:id', async (c) => {
  const db = getDb()
  const [file] = await db.select().from(files).where(eq(files.id, c.req.param('id'))).limit(1)
  if (!file) {
    throw new HTTPException(404, { message: 'File not found' })
  }

  const absolute = path.join(UPLOAD_DIR, path.basename(file.path))
  const bytes = await readFile(absolute)
  return new Response(bytes, {
    headers: {
      'Content-Type': file.mime,
      'Content-Length': String(file.size),
    },
  })
})
