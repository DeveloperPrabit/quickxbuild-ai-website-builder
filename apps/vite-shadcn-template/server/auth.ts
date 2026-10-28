import { and, eq, gt } from 'drizzle-orm'
import type { Context, Next } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { HTTPException } from 'hono/http-exception'
import bcrypt from 'bcryptjs'
import { z } from 'zod/v4'
import { getDb } from './db'
import { sendAppMail } from './mail'
import { emitUsersChanged } from './realtime'
import { invites, passwordResets, sessions, users, type User } from './schema'

const SESSION_COOKIE = 'app_session'
const SESSION_DAYS = 7
export const APP_URL = process.env.APP_URL || 'http://localhost:5174'
const ADMIN_ROLES = new Set(['owner', 'admin'])

export type PublicUser = {
  id: string
  email: string
  name: string
  role: string
  disabled: boolean
}

export type SignupInput = z.infer<typeof SignupInput>
export const SignupInput = z.object({
  email: z.email(),
  password: z.string().min(8),
  name: z.string().min(1).max(80),
  inviteToken: z.string().optional(),
})

export type LoginInput = z.infer<typeof LoginInput>
export const LoginInput = z.object({
  email: z.email(),
  password: z.string().min(1),
})

export type ForgotInput = z.infer<typeof ForgotInput>
export const ForgotInput = z.object({
  email: z.email(),
})

export type ResetInput = z.infer<typeof ResetInput>
export const ResetInput = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
})

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    disabled: user.disabled,
  }
}

export function isAdminRole(role: string): boolean {
  return ADMIN_ROLES.has(role)
}

declare module 'hono' {
  interface ContextVariableMap {
    user: User
  }
}

export async function createSession(userId: string): Promise<string> {
  const db = getDb()
  const sessionId = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000)
  await db.insert(sessions).values({ id: sessionId, userId, expiresAt })
  return sessionId
}

export function setSessionCookie(c: Context, sessionId: string) {
  setCookie(c, SESSION_COOKIE, sessionId, {
    httpOnly: true,
    path: '/',
    sameSite: 'Lax',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  })
}

export async function getSessionUser(c: Context): Promise<User | null> {
  const sessionId = getCookie(c, SESSION_COOKIE)
  if (!sessionId) {
    return null
  }

  const db = getDb()
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1)
  if (!session || session.expiresAt.getTime() < Date.now()) {
    if (session) {
      await db.delete(sessions).where(eq(sessions.id, sessionId))
    }
    return null
  }

  const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1)
  if (!user || user.disabled) {
    return null
  }
  return user
}

export async function requireAuth(c: Context, next: Next) {
  const user = await getSessionUser(c)
  if (!user) {
    throw new HTTPException(401, { message: 'Authentication required' })
  }
  c.set('user', user)
  await next()
}

export function requireRole(...roles: string[]) {
  return async (c: Context, next: Next) => {
    const user = await getSessionUser(c)
    if (!user) {
      throw new HTTPException(401, { message: 'Authentication required' })
    }
    if (!roles.includes(user.role)) {
      throw new HTTPException(403, { message: 'Insufficient role' })
    }
    c.set('user', user)
    await next()
  }
}

export async function requireAdmin(c: Context, next: Next) {
  const user = await getSessionUser(c)
  if (!user) {
    throw new HTTPException(401, { message: 'Authentication required' })
  }
  if (!isAdminRole(user.role)) {
    throw new HTTPException(403, { message: 'Admin access required' })
  }
  c.set('user', user)
  await next()
}

export async function signup(c: Context) {
  const parsed = SignupInput.safeParse(await c.req.json())
  if (!parsed.success) {
    throw new HTTPException(400, { message: 'Invalid signup payload' })
  }

  const db = getDb()
  const email = parsed.data.email.toLowerCase()
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1)
  if (existing) {
    throw new HTTPException(409, { message: 'Email already registered' })
  }

  let role = 'member'
  if (parsed.data.inviteToken) {
    const [invite] = await db.select().from(invites).where(and(
      eq(invites.token, parsed.data.inviteToken),
      gt(invites.expiresAt, new Date())
    )).limit(1)
    if (!invite || invite.email.toLowerCase() !== email) {
      throw new HTTPException(400, { message: 'Invalid or expired invite' })
    }
    role = invite.role
    await db.delete(invites).where(eq(invites.id, invite.id))
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10)
  const [user] = await db.insert(users).values({
    id: crypto.randomUUID(),
    email,
    passwordHash,
    name: parsed.data.name,
    role,
  }).returning()

  const sessionId = await createSession(user.id)
  setSessionCookie(c, sessionId)
  emitUsersChanged({ action: 'created', userId: user.id, user: toPublicUser(user) })
  return c.json({ user: toPublicUser(user) }, 201)
}

export async function login(c: Context) {
  const parsed = LoginInput.safeParse(await c.req.json())
  if (!parsed.success) {
    throw new HTTPException(400, { message: 'Invalid login payload' })
  }

  const db = getDb()
  const email = parsed.data.email.toLowerCase()
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1)
  if (!user || user.disabled || user.passwordHash.startsWith('oauth:')) {
    throw new HTTPException(401, { message: 'Invalid email or password' })
  }

  const matches = await bcrypt.compare(parsed.data.password, user.passwordHash)
  if (!matches) {
    throw new HTTPException(401, { message: 'Invalid email or password' })
  }

  const sessionId = await createSession(user.id)
  setSessionCookie(c, sessionId)
  return c.json({ user: toPublicUser(user) })
}

export async function logout(c: Context) {
  const sessionId = getCookie(c, SESSION_COOKIE)
  if (sessionId) {
    const db = getDb()
    await db.delete(sessions).where(eq(sessions.id, sessionId))
  }
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
  return c.json({ ok: true })
}

export async function me(c: Context) {
  const user = await getSessionUser(c)
  if (!user) {
    throw new HTTPException(401, { message: 'Authentication required' })
  }
  return c.json({ user: toPublicUser(user) })
}

export async function forgotPassword(c: Context) {
  const parsed = ForgotInput.safeParse(await c.req.json())
  if (!parsed.success) {
    throw new HTTPException(400, { message: 'Invalid email' })
  }

  const db = getDb()
  const [user] = await db.select().from(users).where(eq(users.email, parsed.data.email.toLowerCase())).limit(1)
  if (user && !user.passwordHash.startsWith('oauth:')) {
    const token = crypto.randomUUID()
    await db.insert(passwordResets).values({
      id: crypto.randomUUID(),
      userId: user.id,
      token,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    })
    const resetUrl = `${APP_URL}/reset?token=${token}`
    await sendAppMail({
      to: user.email,
      subject: 'Reset your password',
      text: `Reset your password: ${resetUrl}`,
    })
  }
  return c.json({ ok: true })
}

export async function resetPassword(c: Context) {
  const parsed = ResetInput.safeParse(await c.req.json())
  if (!parsed.success) {
    throw new HTTPException(400, { message: 'Invalid reset payload' })
  }

  const db = getDb()
  const [reset] = await db.select().from(passwordResets).where(and(
    eq(passwordResets.token, parsed.data.token),
    gt(passwordResets.expiresAt, new Date())
  )).limit(1)
  if (!reset) {
    throw new HTTPException(400, { message: 'Invalid or expired reset token' })
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10)
  await db.update(users).set({ passwordHash }).where(eq(users.id, reset.userId))
  await db.delete(passwordResets).where(eq(passwordResets.id, reset.id))
  return c.json({ ok: true })
}
