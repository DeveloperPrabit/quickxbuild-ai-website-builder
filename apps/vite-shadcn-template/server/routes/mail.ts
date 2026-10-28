import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod/v4'
import { requireAdmin } from '../auth'
import { mailConfigured, sendAppMail } from '../mail'
import type { User } from '../schema'

type AuthEnv = {
  Variables: {
    user: User
  }
}

export type MailTestInput = z.infer<typeof MailTestInput>
export const MailTestInput = z.object({
  to: z.email(),
  subject: z.string().min(1).max(120).optional().default('Test email'),
  text: z.string().min(1).max(2000).optional().default('Hello from the generated app.'),
})

export const mailRouter = new Hono<AuthEnv>()

mailRouter.use('*', requireAdmin)

mailRouter.get('/status', (c) => c.json({ configured: mailConfigured() }))

mailRouter.post('/test', async (c) => {
  const parsed = MailTestInput.safeParse(await c.req.json())
  if (!parsed.success) {
    throw new HTTPException(400, { message: 'Invalid mail payload' })
  }
  const result = await sendAppMail(parsed.data)
  return c.json(result)
})
