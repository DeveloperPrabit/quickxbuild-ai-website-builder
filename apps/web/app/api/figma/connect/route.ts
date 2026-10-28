import { env } from '@/env.mjs'
import { figmaRedirectUri } from '@/lib/figma-oauth'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function GET() {
  if (!env.FIGMA_CLIENT_ID) {
    return NextResponse.json({ error: 'FIGMA_CLIENT_ID is not set' }, { status: 501 })
  }

  const state = crypto.randomUUID()
  const redirectUri = figmaRedirectUri()
  const cookieStore = await cookies()
  cookieStore.set('figma_oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: redirectUri.startsWith('https://'),
    path: '/',
    maxAge: 600,
  })

  const params = new URLSearchParams({
    client_id: env.FIGMA_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'file_content:read',
    state,
    response_type: 'code',
  })

  return NextResponse.redirect(`https://www.figma.com/oauth?${params}`)
}
