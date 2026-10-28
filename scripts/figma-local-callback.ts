/**
 * One-off local Figma OAuth catcher for http://localhost:3001
 * after Figma redirects to a port nothing else is serving.
 */
import { createServer } from 'node:http'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const envPath = resolve(import.meta.dir, '../.env')
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=')
      return [line.slice(0, index), line.slice(index + 1)]
    })
)

function upsert(source: string, key: string, value: string) {
  const line = `${key}=${value}`
  const pattern = new RegExp(`^${key}=.*$`, 'm')
  if (pattern.test(source)) {
    return source.replace(pattern, line)
  }
  return `${source.endsWith('\n') ? source : `${source}\n`}${line}\n`
}

async function exchange(code: string, redirectUri: string) {
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
  return {
    status: response.status,
    data: await response.json() as { access_token?: string; error?: string; message?: string },
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost:3001')
  if (url.pathname !== '/api/figma/callback') {
    res.writeHead(404)
    res.end('not found')
    return
  }

  const code = url.searchParams.get('code')
  if (!code) {
    res.writeHead(400)
    res.end('missing code')
    return
  }

  const candidates = [
    'http://localhost:3001/api/figma/callback',
    'https://localhost:3001/api/figma/callback',
    'https://localhost:3000/api/figma/callback',
  ]

  let token: string | undefined
  let lastError = 'token exchange failed'
  for (const redirectUri of candidates) {
    const result = await exchange(code, redirectUri)
    if (result.data.access_token) {
      token = result.data.access_token
      break
    }
    lastError = result.data.error || result.data.message || `status ${result.status}`
  }

  if (!token) {
    res.writeHead(502, { 'Content-Type': 'text/plain' })
    res.end(`Figma token exchange failed: ${lastError}. Click connect again.`)
    return
  }

  let text = readFileSync(envPath, 'utf8')
  text = upsert(text, 'FIGMA_ACCESS_TOKEN', token)
  text = upsert(text, 'FIGMA_REDIRECT_URI', 'https://localhost:3000/api/figma/callback')
  writeFileSync(envPath, text)

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end('<h1>Figma connected</h1><p>Access token saved to local .env. You can close this tab.</p>')
  server.close()
})

server.listen(3001, '127.0.0.1', () => {
  console.log('Reload the Figma callback tab at http://localhost:3001/api/figma/callback')
})
