import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { log } from '@quickxbuild/common'

const API_PORT = process.env.APP_API_PORT || '8787'
const HEALTH_URL = `http://127.0.0.1:${API_PORT}/api/health`

let managedApi: ChildProcess | undefined
let managedSchema: string | undefined
let managedVite: ChildProcess | undefined
let managedNext: ChildProcess | undefined

function getPreviewRoot(): string {
  return process.env.LOCAL_PREVIEW_ROOT
    || path.resolve(process.cwd(), '../vite-shadcn-template')
}

export function schemaForProject(projectId: string): string {
  const safe = projectId.replace(/[^a-zA-Z0-9_]/g, '')
  return `app_${safe || 'local'}`
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function stopProcess(child: ChildProcess | undefined) {
  if (!child?.pid) {
    return
  }

  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    })
    return
  }

  child.kill('SIGTERM')
}

async function isUrlReachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      tls: { rejectUnauthorized: false },
    } as RequestInit)
    if (!(response.ok || response.status === 404)) {
      return false
    }
    const body = await response.text()
    return body.trim().length > 0
  } catch {
    return false
  }
}

function stopLocalPreviewListeners(port: string) {
  const previewUrl = process.env.LOCAL_PREVIEW_URL || 'http://127.0.0.1:5174'
  if (!['localhost', '127.0.0.1'].some((host) => previewUrl.includes(host))) {
    return
  }

  try {
    if (process.platform === 'win32') {
      const output = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8' })
      const pids = [...new Set(
        output
          .split(/\r?\n/)
          .filter((line) => line.includes(`:${port}`) && /LISTENING\s+\d+/.test(line))
          .map((line) => line.trim().split(/\s+/).at(-1))
          .filter((pid): pid is string => Boolean(pid))
      )]
      for (const pid of pids) {
        execFileSync('taskkill', ['/PID', pid, '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      }
      return
    }

    const output = execFileSync('sh', ['-c', `lsof -ti tcp:${port}`], { encoding: 'utf8' })
    for (const pid of output.split(/\s+/).filter(Boolean)) {
      process.kill(Number(pid), 'SIGTERM')
    }
  } catch {
    // The port may be free or the platform may not expose a port inspection command.
  }
}

function repairPreviewCsp(root: string) {
  const configPath = path.join(root, 'vite.config.ts')
  try {
    const config = readFileSync(configPath, 'utf8')
    let frameExtra = ''
    const frameSources = [
      process.env.PREVIEW_FRAME_ANCESTORS,
      process.env.NEXT_PUBLIC_APP_URL,
      process.env.PUBLIC_PREVIEW_URL,
    ]
    for (const raw of frameSources) {
      if (!raw?.trim()) continue
      for (const part of raw.trim().split(/\s+/)) {
        try {
          const origin = new URL(part).origin
          if (origin && !frameExtra.includes(origin)) {
            frameExtra += ` ${origin}`
          }
        } catch {
          // ignore invalid URLs
        }
      }
    }

    let repaired = config.replace(
      /function frameAncestorCsp\(\): string \{[\s\S]*?\n\}/,
      `function frameAncestorCsp(): string {\n  return "frame-ancestors 'self' http://localhost:* https://localhost:* http://127.0.0.1:* https://127.0.0.1:*${frameExtra}"\n}`
    )

    const viteBase = process.env.VITE_BASE?.trim()
    if (viteBase && viteBase !== '/' && !/base:\s*['"`]/.test(repaired)) {
      const normalizedBase = viteBase.endsWith('/') ? viteBase : `${viteBase}/`
      repaired = repaired.replace(
        /return \{\s*\n(\s*)server:/,
        `return {\n$1base: '${normalizedBase}',\n$1server:`
      )
    }

    if (!repaired.includes('PREVIEW_ROUTES')) {
      repaired = repaired.replace(
        'var start = function () {',
        `var start = function () {
    var reportRoutes = function () {
      try {
        var routes = Array.prototype.map.call(document.querySelectorAll('a[href]'), function (link) {
          return new URL(link.getAttribute('href'), window.location.href).pathname;
        }).filter(function (route, index, all) {
          return route.startsWith('/') && all.indexOf(route) === index;
        });
        routes.push(window.location.pathname);
        window.parent.postMessage({ type: 'PREVIEW_ROUTES', payload: { routes: routes } }, '*');
      } catch (ignore) {}
    };
    reportRoutes();
    window.addEventListener('popstate', reportRoutes);`
      )
    }
    if (repaired !== config) {
      writeFileSync(configPath, repaired)
    }
  } catch (error) {
    log.project('warn', 'Unable to repair local preview CSP', {
      root,
      error: error instanceof Error ? error.message : String(error),
      operation: 'local-vite',
    })
  }
}

async function readHealth(): Promise<{ ok?: boolean; schema?: string } | null> {
  try {
    const response = await fetch(HEALTH_URL)
    if (!response.ok) {
      return null
    }
    return await response.json() as { ok?: boolean; schema?: string }
  } catch {
    return null
  }
}

async function waitUntil(check: () => Promise<boolean>, attempts = 40): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await check()) {
      return true
    }
    await sleep(250)
  }
  return false
}

function parsePreviewPort(previewUrl: string): string {
  try {
    return new URL(previewUrl).port || '5174'
  } catch {
    return '5174'
  }
}

/** Health URL for in-process Vite (honors VITE_BASE path prefix). */
function resolveViteHealthUrl(previewUrl: string): string {
  const viteBase = (process.env.VITE_BASE || '/').trim() || '/'
  try {
    const url = new URL(previewUrl)
    if (viteBase !== '/') {
      const normalized = viteBase.endsWith('/') ? viteBase : `${viteBase}/`
      url.pathname = normalized
      url.search = ''
      url.hash = ''
    } else if (!url.pathname.endsWith('/')) {
      url.pathname = `${url.pathname}/`
    }
    return url.toString()
  } catch {
    return previewUrl
  }
}

/**
 * Start the local Vite preview if nothing is listening on LOCAL_PREVIEW_URL.
 * When QuickXBuild is HTTPS, Vite must also be HTTPS or the IDE iframe stays blank (mixed content).
 * Hosted /__preview/ proxies terminate TLS at nginx/Next — keep Vite HTTP on loopback.
 */
export async function ensureLocalVite(previewUrl: string): Promise<void> {
  const healthUrl = resolveViteHealthUrl(previewUrl)
  if (await isUrlReachable(healthUrl)) {
    return
  }

  const wantsHttps = previewUrl.startsWith('https://')
  const httpTwin = previewUrl.replace(/^https:/, 'http:')
  const httpHealth = resolveViteHealthUrl(httpTwin)

  if (managedVite) {
    stopProcess(managedVite)
    managedVite = undefined
    await sleep(400)
  } else if (wantsHttps && await isUrlReachable(httpHealth)) {
    log.project('warn', 'Local Vite is HTTP while QuickXBuild is HTTPS; starting a matching HTTPS preview', {
      previewUrl,
      operation: 'local-vite',
    })
  }

  if (await isUrlReachable(healthUrl)) {
    return
  }

  const root = getPreviewRoot()
  const port = parsePreviewPort(previewUrl)
  repairPreviewCsp(root)
  stopLocalPreviewListeners(port)
  managedVite = spawn('bun', ['x', 'vite', '--port', port, '--host'], {
    cwd: root,
    env: {
      ...process.env,
      LOCAL_PREVIEW_HTTPS: wantsHttps ? '1' : process.env.LOCAL_PREVIEW_HTTPS,
    },
    stdio: 'ignore',
    windowsHide: true,
  })
  managedVite.on('exit', () => {
    managedVite = undefined
  })

  const ready = await waitUntil(() => isUrlReachable(healthUrl))
  log.project(ready ? 'info' : 'warn', ready
    ? 'Local Vite preview is ready'
    : 'Local Vite preview did not become ready in time', {
    previewUrl,
    healthUrl,
    port,
    root,
    operation: 'local-vite',
  })
}

function stopManagedApi() {
  stopProcess(managedApi)
  managedApi = undefined
  managedSchema = undefined
}

async function startManagedApi(
  projectId: string,
  schema: string,
  tenantId?: string
): Promise<void> {
  const root = getPreviewRoot()

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    APP_SCHEMA: schema,
    APP_API_PORT: API_PORT,
  }

  // Prefer Neon for login/signup (per-project APP_SCHEMA). Keep data proxy as optional sidecar.
  const neonUrl = (process.env.POSTGRES_URL || process.env.DATABASE_URL || '').trim()
  if (neonUrl) {
    childEnv.DATABASE_URL = neonUrl
  }

  if (tenantId) {
    try {
      const { buildGeneratedAppDbEnv } = await import('./generated-app-db-env')
      const injected = buildGeneratedAppDbEnv(projectId, tenantId)
      Object.assign(childEnv, injected)
      if (schema) {
        childEnv.APP_SCHEMA = schema
      }
      log.project('info', 'Injected Neon + data proxy credentials into generated app API', {
        projectId,
        tenantId,
        schema: childEnv.APP_SCHEMA,
        operation: 'local-app-api',
      })
    } catch (error) {
      log.project(
        'warn',
        'Failed to build generated app DB env',
        {
          projectId,
          operation: 'local-app-api',
        },
        error instanceof Error ? error : new Error(String(error))
      )
    }
  } else if (!neonUrl) {
    log.project('warn', 'No Neon URL or tenantId for local app API', {
      projectId,
      operation: 'local-app-api',
    })
  }

  managedApi = spawn('bun', ['--watch', 'run', 'server/index.ts'], {
    cwd: root,
    env: childEnv,
    stdio: 'ignore',
    windowsHide: true,
  })
  managedSchema = schema
  managedApi.on('exit', () => {
    if (managedSchema === schema) {
      managedApi = undefined
      managedSchema = undefined
    }
  })

  const ready = await waitUntil(async () => {
    const health = await readHealth()
    return Boolean(health?.ok && health.schema === schema)
  })
  log.project(ready ? 'info' : 'warn', ready
    ? 'Local generated-app API is ready'
    : 'Local generated-app API did not become healthy in time', {
    projectId,
    schema,
    port: API_PORT,
    root,
    operation: 'local-app-api',
  })
}

/**
 * Start (or reuse) the generated-app Node API for local preview.
 * Pass reload=true after apply so new server/ files are picked up.
 */
export async function ensureLocalAppApi(
  projectId: string,
  options: { reload?: boolean; tenantId?: string } = {}
): Promise<void> {
  const schema = schemaForProject(projectId)
  const health = await readHealth()

  if (options.reload && managedApi) {
    stopManagedApi()
    await sleep(400)
    await startManagedApi(projectId, schema, options.tenantId)
    return
  }

  if (health?.ok && health.schema === schema) {
    if (options.reload && !managedApi) {
      log.project('warn', 'Local app API is running outside QuickXBuild; restart it to load server file changes', {
        projectId,
        schema,
        operation: 'local-app-api',
      })
    }
    return
  }

  if (managedApi) {
    stopManagedApi()
    await sleep(400)
  }

  const stillUp = await readHealth()
  if (stillUp?.ok && stillUp.schema !== schema) {
    log.project('warn', 'Local app API is already running with a different schema', {
      projectId,
      expectedSchema: schema,
      runningSchema: stillUp.schema,
      operation: 'local-app-api',
    })
    return
  }

  await startManagedApi(projectId, schema, options.tenantId)
}

export async function ensureLocalNext(): Promise<void> {
  const previewUrl = process.env.LOCAL_NEXT_PREVIEW_URL
  if (!previewUrl) {
    return
  }
  if (await isUrlReachable(previewUrl)) {
    return
  }
  const root = path.resolve(process.cwd(), '../next-shadcn-template')
  managedNext = spawn('bun', ['run', 'dev'], {
    cwd: root,
    env: process.env,
    stdio: 'ignore',
    windowsHide: true,
  })
  managedNext.on('exit', () => {
    managedNext = undefined
  })
  await waitUntil(() => isUrlReachable(previewUrl))
}

/**
 * Make sure Vite and the Node API are both running for local preview.
 */
const PACKAGE_NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i

export async function installPreviewPackages(packages: string[]): Promise<{
  ok: boolean
  output: string
}> {
  const sanitized = packages.filter((pkg) => PACKAGE_NAME.test(pkg))
  if (sanitized.length === 0) {
    return { ok: false, output: 'No valid package names' }
  }

  const root = getPreviewRoot()
  return await new Promise((resolve) => {
    const child = spawn('bun', ['add', ...sanitized], {
      cwd: root,
      env: process.env,
      windowsHide: true,
    })
    let output = ''
    child.stdout?.on('data', (chunk) => {
      output += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      output += String(chunk)
    })
    child.on('exit', (code) => {
      resolve({
        ok: code === 0,
        output: output.trim() || (code === 0 ? `Installed ${sanitized.join(', ')}` : 'bun add failed'),
      })
    })
    child.on('error', (error) => {
      resolve({ ok: false, output: error.message })
    })
  })
}

export async function ensureLocalPreviewStack(
  projectId: string,
  previewUrl: string,
  options: { reloadApi?: boolean; tenantId?: string } = {}
): Promise<void> {
  await Promise.all([
    ensureLocalVite(previewUrl),
    ensureLocalAppApi(projectId, { reload: options.reloadApi, tenantId: options.tenantId }),
    ensureLocalNext(),
  ])
}
