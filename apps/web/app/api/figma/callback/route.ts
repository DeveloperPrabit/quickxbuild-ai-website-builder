import { env } from '@/env.mjs'
import { figmaRedirectUri } from '@/lib/figma-oauth'
import { cookies } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  const state = request.nextUrl.searchParams.get('state')
  const cookieStore = await cookies()
  const expected = cookieStore.get('figma_oauth_state')?.value
  cookieStore.delete('figma_oauth_state')

  if (!code || !state || !expected || state !== expected) {
    return NextResponse.json({ error: 'Invalid Figma OAuth state' }, { status: 400 })
  }

  if (!env.FIGMA_CLIENT_ID || !env.FIGMA_CLIENT_SECRET) {
    return NextResponse.json({ error: 'Figma OAuth is not configured' }, { status: 501 })
  }

  const redirectUri = figmaRedirectUri()
  const basic = Buffer.from(`${env.FIGMA_CLIENT_ID}:${env.FIGMA_CLIENT_SECRET}`).toString('base64')
  const response = await fetch('https://api.figma.com/v1/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      redirect_uri: redirectUri,
      code,
      grant_type: 'authorization_code',
    }),
  })

  const data = await response.json() as { access_token?: string; error?: string }
  if (!response.ok || !data.access_token) {
    return NextResponse.json({ error: data.error || 'Figma token exchange failed' }, { status: 502 })
  }

  return new NextResponse(
    `<!doctype html><html><body style="font-family:sans-serif;padding:32px">
      <h1>Figma connected</h1>
      <p>Put this value in local <code>.env</code> as <code>FIGMA_ACCESS_TOKEN</code>, then restart the web app. Do not commit it.</p>
      <textarea readonly rows="4" style="width:100%">${data.access_token}</textarea>
    </body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  )
}
