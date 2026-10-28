/**
 * Create a clothing ecommerce project for prabitjoshi@gmail.com
 * and run Figma-aware AI generation.
 */
import { createServer } from 'node:https'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { Agent, fetch as undiciFetch } from 'undici'

const ROOT = resolve(import.meta.dir, '..')
const ENV_PATH = resolve(ROOT, '.env')
const USER_ID = 'Rm1JIaJrpqjrQJBYPD2LjO43yGkJAMEi'
const ORG_ID = 'dkoh2c4phmak1jt19i727k9w'
const PROMPT = 'Generate a Figma design then implement a fullstack clothing ecommerce storefront, cream and black. Use integer minor-unit prices and cost, products/orders/ledger, unpaid COD first, Admin analytics, and /shop catalog. Map the designSpec frames to pages.'

function readEnv(): Record<string, string> {
  return Object.fromEntries(
    readFileSync(ENV_PATH, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=')
        return [line.slice(0, index), line.slice(index + 1)]
      })
  )
}

function upsertEnv(key: string, value: string) {
  let text = readFileSync(ENV_PATH, 'utf8')
  const line = `${key}=${value}`
  const pattern = new RegExp(`^${key}=.*$`, 'm')
  text = pattern.test(text) ? text.replace(pattern, line) : `${text.endsWith('\n') ? text : `${text}\n`}${line}\n`
  writeFileSync(ENV_PATH, text)
}

function figmaHeaders(token: string): Record<string, string> {
  return token.startsWith('figu_')
    ? { Authorization: `Bearer ${token}` }
    : { 'X-Figma-Token': token }
}

async function setupFigma(env: Record<string, string>) {
  const token = env.FIGMA_ACCESS_TOKEN
  if (!token) {
    throw new Error('FIGMA_ACCESS_TOKEN is missing')
  }
  const headers = figmaHeaders(token)
  const me = await fetch('https://api.figma.com/v1/me', { headers })
  const meBody = await me.json() as { handle?: string; email?: string; err?: string }
  if (!me.ok) {
    console.log(`Figma /me ${me.status} ${meBody.err || 'invalid token'}. Continuing with local designSpec.`)
    return { fileKey: null, handle: null, fileUrl: null }
  }
  console.log(`Figma account: ${meBody.handle || meBody.email || 'ok'}`)

  let fileKey = env.FIGMA_FILE_KEY
  if (!fileKey && env.FIGMA_TEAM_ID) {
    const projects = await fetch(`https://api.figma.com/v1/teams/${env.FIGMA_TEAM_ID}/projects`, { headers })
    const projectData = await projects.json() as { projects?: Array<{ id: string }> }
    const firstProject = projectData.projects?.[0]?.id
    if (firstProject) {
      const files = await fetch(`https://api.figma.com/v1/projects/${firstProject}/files`, { headers })
      const fileData = await files.json() as { files?: Array<{ key: string }> }
      fileKey = fileData.files?.[0]?.key
    }
  }

  if (fileKey) {
    const file = await fetch(`https://api.figma.com/v1/files/${fileKey}`, { headers })
    if (file.ok) {
      const comment = await fetch(`https://api.figma.com/v1/files/${fileKey}/comments`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'QuickXBuild design brief: cream and black clothing storefront. Home hero + catalog grid. Codegen maps these frames to / and /shop.',
        }),
      })
      console.log(`Figma file ${fileKey} ${comment.ok ? 'comment posted' : `comment ${comment.status}`}`)
      upsertEnv('FIGMA_FILE_KEY', fileKey)
      return { fileKey, handle: meBody.handle, fileUrl: `https://www.figma.com/design/${fileKey}` }
    }
  }

  console.log('No readable Figma file key yet. Codegen will use the local designSpec and still call Figma auth.')
  return { fileKey: fileKey || null, handle: meBody.handle, fileUrl: null }
}

function insecureAgent() {
  return new Agent({ connect: { rejectUnauthorized: false } })
}

async function trpc(base: string, token: string, path: string, input: unknown) {
  const response = await undiciFetch(`${base}/api/trpc/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ json: input }),
    dispatcher: insecureAgent(),
  })
  const text = await response.text()
  let data: any
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`${path} ${response.status} ${text.slice(0, 300)}`)
  }
  if (!response.ok || data.error) {
    throw new Error(`${path} failed ${response.status} ${JSON.stringify(data.error || data)}`)
  }
  return data.result?.data?.json ?? data.result?.data ?? data
}

async function generate(base: string, token: string, projectId: string, planId: string) {
  const response = await undiciFetch(`${base}/api/ai`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: PROMPT,
      planId,
      projectId,
    }),
    dispatcher: insecureAgent(),
  })
  if (!response.ok || !response.body) {
    throw new Error(`AI generate failed ${response.status} ${await response.text()}`)
  }

  const files: Array<{ path: string; basename: string; dirname: string; modified: string; original: string | null; description: string }> = []
  const notes: string[] = []
  let buffer = ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const chunk = JSON.parse(line)
        if (chunk.type === 'research') {
          notes.push(chunk.data?.content || '')
          console.log(`research: ${(chunk.data?.content || '').slice(0, 120)}`)
        }
        if (chunk.type === 'action' && chunk.data?.type === 'file') {
          files.push(chunk.data)
          console.log(`file: ${chunk.data.path}`)
        }
      } catch {
        // ignore partial JSON
      }
    }
  }
  return { files, notes }
}

async function main() {
  const env = readEnv()
  const figma = await setupFigma(env)
  const sessionPath = resolve(ROOT, 'apps/web/tmp-session.json')
  if (!existsSync(sessionPath)) {
    throw new Error('Session export missing. Run the D1 session dump first.')
  }
  const session = JSON.parse(readFileSync(sessionPath, 'utf8')) as { token: string }
  const base = process.env.QUICKXBUILD_URL || 'https://localhost:3000'

  const created = await trpc(base, session.token, 'project.create', {
    name: 'Atelier Clothing',
    initialMessage: PROMPT,
    templateType: 'default',
  })
  const projectId = created.id || created.project?.id
  if (!projectId) {
    throw new Error(`Create returned no id: ${JSON.stringify(created)}`)
  }
  console.log(`Project created ${projectId} for org ${ORG_ID} user ${USER_ID}`)

  const planId = `cloth-${Date.now()}`
  const generated = await generate(base, session.token, projectId, planId)
  const messages = [
    { type: 'user', message: PROMPT, planId, contentType: 'user_message' },
    ...generated.notes.map((content) => ({ type: 'plan', planId, content, contentType: 'plan' })),
    {
      type: 'diff',
      planId,
      contentType: 'files',
      diff: generated.files.map((file) => ({
        modified: file.modified,
        original: file.original,
        basename: file.basename,
        dirname: file.dirname,
        path: file.path,
        additions: 1,
        deletions: 0,
        type: file.original ? 'edit' : 'create',
      })),
    },
  ]
  await trpc(base, session.token, 'history.appendHistory', { id: projectId, messages })
  const preview = await trpc(base, session.token, 'project.updateContainerContent', { id: projectId })
  console.log(JSON.stringify({
    projectId,
    owner: 'prabitjoshi@gmail.com',
    fileCount: generated.files.length,
    figmaFile: figma.fileUrl,
    figmaHandle: figma.handle,
    previewURL: preview.previewURL || preview.url || null,
    notes: generated.notes.slice(0, 3),
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
