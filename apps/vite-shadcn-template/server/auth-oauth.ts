import { eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { APP_URL, createSession, setSessionCookie, toPublicUser } from './auth'
import { getDb } from './db'
import { emitUsersChanged } from './realtime'
import { users } from './schema'

const oauthStates = new Map<string, { provider: 'google' | 'github'; expires: number }>()

function apiBase(): string {
  return process.env.APP_API_URL || 'http://127.0.0.1:8787'
}

function requireOAuthConfig(provider: 'google' | 'github') {
  if (provider === 'google') {
    const id = process.env.GOOGLE_CLIENT_ID
    const secret = process.env.GOOGLE_CLIENT_SECRET
    if (!id || !secret) {
      throw new HTTPException(501, { message: 'Google OAuth is not configured' })
    }
    return { id, secret }
  }
  const id = process.env.GITHUB_CLIENT_ID
  const secret = process.env.GITHUB_CLIENT_SECRET
  if (!id || !secret) {
    throw new HTTPException(501, { message: 'GitHub OAuth is not configured' })
  }
  return { id, secret }
}

function createState(provider: 'google' | 'github'): string {
  const state = crypto.randomUUID()
  oauthStates.set(state, { provider, expires: Date.now() + 10 * 60 * 1000 })
  return state
}

function consumeState(state: string, provider: 'google' | 'github') {
  const entry = oauthStates.get(state)
  oauthStates.delete(state)
  if (!entry || entry.provider !== provider || entry.expires < Date.now()) {
    throw new HTTPException(400, { message: 'Invalid OAuth state' })
  }
}

async function upsertOauthUser(email: string, name: string, provider: string) {
  const db = getDb()
  const normalized = email.toLowerCase()
  const [existing] = await db.select().from(users).where(eq(users.email, normalized)).limit(1)
  if (existing) {
    if (existing.disabled) {
      throw new HTTPException(401, { message: 'Account disabled' })
    }
    return existing
  }

  const [user] = await db.insert(users).values({
    id: crypto.randomUUID(),
    email: normalized,
    passwordHash: `oauth:${provider}`,
    name,
    role: 'member',
  }).returning()
  emitUsersChanged({ action: 'created', userId: user.id, user: toPublicUser(user) })
  return user
}

export async function startGoogle(c: Context) {
  const { id } = requireOAuthConfig('google')
  const state = createState('google')
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', id)
  url.searchParams.set('redirect_uri', `${apiBase()}/api/auth/google/callback`)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'openid email profile')
  url.searchParams.set('state', state)
  return c.redirect(url.toString())
}

export async function googleCallback(c: Context) {
  const { id, secret } = requireOAuthConfig('google')
  const code = c.req.query('code')
  const state = c.req.query('state')
  if (!code || !state) {
    throw new HTTPException(400, { message: 'Missing OAuth code' })
  }
  consumeState(state, 'google')

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: id,
      client_secret: secret,
      redirect_uri: `${apiBase()}/api/auth/google/callback`,
      grant_type: 'authorization_code',
    }),
  })
  const tokens = await tokenResponse.json() as { access_token?: string }
  if (!tokens.access_token) {
    throw new HTTPException(401, { message: 'Google token exchange failed' })
  }

  const profileResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  const profile = await profileResponse.json() as { email?: string; name?: string }
  if (!profile.email) {
    throw new HTTPException(401, { message: 'Google profile has no email' })
  }

  const user = await upsertOauthUser(profile.email, profile.name || profile.email, 'google')
  setSessionCookie(c, await createSession(user.id))
  return c.redirect(`${APP_URL}/dashboard`)
}

export async function startGithub(c: Context) {
  const { id } = requireOAuthConfig('github')
  const state = createState('github')
  const url = new URL('https://github.com/login/oauth/authorize')
  url.searchParams.set('client_id', id)
  url.searchParams.set('redirect_uri', `${apiBase()}/api/auth/github/callback`)
  url.searchParams.set('scope', 'user:email')
  url.searchParams.set('state', state)
  return c.redirect(url.toString())
}

export async function githubCallback(c: Context) {
  const { id, secret } = requireOAuthConfig('github')
  const code = c.req.query('code')
  const state = c.req.query('state')
  if (!code || !state) {
    throw new HTTPException(400, { message: 'Missing OAuth code' })
  }
  consumeState(state, 'github')

  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: id,
      client_secret: secret,
      code,
      redirect_uri: `${apiBase()}/api/auth/github/callback`,
    }),
  })
  const tokens = await tokenResponse.json() as { access_token?: string }
  if (!tokens.access_token) {
    throw new HTTPException(401, { message: 'GitHub token exchange failed' })
  }

  const profileResponse = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${tokens.access_token}`, 'User-Agent': 'quickxbuild-app' },
  })
  const profile = await profileResponse.json() as { email?: string; name?: string; login?: string }
  let email = profile.email
  if (!email) {
    const emailsResponse = await fetch('https://api.github.com/user/emails', {
      headers: { Authorization: `Bearer ${tokens.access_token}`, 'User-Agent': 'quickxbuild-app' },
    })
    const emails = await emailsResponse.json() as Array<{ email: string; primary: boolean; verified: boolean }>
    email = emails.find((item) => item.primary && item.verified)?.email || emails[0]?.email
  }
  if (!email) {
    throw new HTTPException(401, { message: 'GitHub profile has no email' })
  }

  const user = await upsertOauthUser(email, profile.name || profile.login || email, 'github')
  setSessionCookie(c, await createSession(user.id))
  return c.redirect(`${APP_URL}/dashboard`)
}

export async function oauthStatus(c: Context) {
  return c.json({
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    github: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
  })
}
