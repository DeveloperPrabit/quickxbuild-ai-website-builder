/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * container.ts
 * Copyright (C) 2025 Nextify Limited
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 */

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { FileStructure } from '@quickxbuild/common'
import { buildFiles as buildFilesWithHistory, log, tryCatch } from '@quickxbuild/common'
import { project, hasPremiumMembership } from '@quickxbuild/db'
import { templateConfigs } from '@quickxbuild/templates'
import { TRPCError } from '@trpc/server'
import { and, eq, isNull, or, like } from 'drizzle-orm'
// Import sandbox abstraction layer
import {
  getSandboxFactory,
  type ISandbox,
  initializeSandboxFactory,
  createConfigFromEnvironment,
  type SandboxProviderType,
  CONTAINER_TIMEOUTS,
  TEMPLATE_MAPPINGS,
  getTimeoutForUserTier
} from '@quickxbuild/sandbox'
// Keep E2B import as fallback
import Sandbox from 'e2b'
import { isExcludedFile } from './excludedFiles'
import { buildGeneratedAppDbEnv, formatEnvFile } from './generated-app-db-env'
import { getBusinessDb, parseMessageHistory, requireOrgAndUser } from './project'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { captureAndStoreScreenshot } from './screenshot-service'
import {env} from "../../env.mjs";

/**
 * Sandbox cleanup result interface
 */
export interface SandboxCleanupResult {
  success: boolean
  containerId: string
  error?: string
}

/**
 * Sandbox termination options
 */
export interface TerminationOptions {
  timeoutMs?: number
  retryCount?: number
  maxRetries?: number
}

/**
 * Global flag to track if sandbox factory is initialized
 */
let sandboxFactoryInitialized = false

function assertSandboxProviderConfigured(provider: SandboxProviderType) {
  if (provider === 'e2b' && !process.env.E2B_API_KEY) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'E2B_API_KEY is required to create preview sandboxes.',
    })
  }

  if (provider === 'daytona' && !process.env.DAYTONA_API_KEY) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'DAYTONA_API_KEY is required to create preview sandboxes.',
    })
  }
}

/**
 * Get the default sandbox provider from configuration or environment
 * Uses a hybrid approach: factory config first, then environment variable, then fallback to 'e2b'
 *
 * @returns {SandboxProviderType} The selected sandbox provider type
 * @throws {Error} Never throws - always returns a valid provider with fallback
 */
function getDefaultSandboxProvider(): SandboxProviderType {
  try {
    // Try to get from initialized factory first
    if (sandboxFactoryInitialized) {
      const factory = getSandboxFactory()
      const defaultProvider = factory.getConfig().defaultProvider
      if (defaultProvider) {
        return defaultProvider
      }
    }
  } catch (error) {
    // Failed to get provider from factory, falling back to environment
  }

  // Fallback to environment variable
  const envProvider = process.env.NEXT_PUBLIC_SANDBOX_DEFAULT_PROVIDER as SandboxProviderType
  if (envProvider && (envProvider === 'e2b' || envProvider === 'daytona')) {
    return envProvider
  }

  // Final fallback to e2b
  return 'e2b'
}

/**
 * Check if error indicates sandbox not found (should create new instead of recover)
 */
function isSandboxNotFoundError(error: any): boolean {
  if (!error) return false

  const errorMessage = error.message?.toLowerCase() || ''
  const errorCode = error.code || error.status

  // Check for common "not found" indicators
  return (
    errorMessage.includes('not found') ||
    errorMessage.includes('does not exist') ||
    errorMessage.includes('sandbox not found') ||
    errorMessage.includes('container not found') ||
    errorCode === 404 ||
    errorCode === 'NOT_FOUND' ||
    // E2B specific not found errors
    errorMessage.includes('sandbox with id') && errorMessage.includes('not found')
  )
}

/**
 * Initialize sandbox factory if not already initialized
 *
 * @returns {Promise<boolean>} True if factory is available, false if fallback to E2B is needed
 */
async function ensureSandboxFactory(): Promise<boolean> {
  if (sandboxFactoryInitialized) {
    return true
  }

  try {
    const config = createConfigFromEnvironment()
    await initializeSandboxFactory(config)
    sandboxFactoryInitialized = true
    return true
  } catch (error) {
    return false
  }
}

/**
 * Get sandbox instance using abstraction layer with fallback to direct E2B
 *
 * @param operation - The sandbox operation to perform
 * @param templateOrId - Template name for create, or sandbox ID for connect/resume
 * @param options - Optional configuration including timeout
 * @returns {Promise<any>} Sandbox instance (ISandbox or native E2B)
 * @throws {Error} If both abstraction layer and E2B fallback fail
 */
export async function getSandboxInstance(
  operation: 'create' | 'connect' | 'resume',
  templateOrId: string,
  options: { timeoutMs?: number; env?: Record<string, string> } = {}
): Promise<any> {
  const provider = getDefaultSandboxProvider()
  assertSandboxProviderConfigured(provider)

  const factoryAvailable = await ensureSandboxFactory()

  if (factoryAvailable) {
    try {
      const factory = getSandboxFactory()
      let sandbox: ISandbox


      switch (operation) {
        case 'create':
          sandbox = await factory.createSandbox({
            provider,
            template: templateOrId,
            timeoutMs: options.timeoutMs,
            env: options.env,
          })
          break
        case 'connect':
          sandbox = await factory.connectToSandbox(templateOrId, provider, {
            timeoutMs: options.timeoutMs
          })
          break
        case 'resume':
          sandbox = await factory.resumeSandbox(templateOrId, provider, {
            timeoutMs: options.timeoutMs
          })
          break
        default:
          throw new Error(`Unknown sandbox operation: ${operation}`)
      }

      return sandbox
    } catch (error) {
      // Abstraction layer operation failed, falling back to E2B
    }
  }

  let sandbox: any
  try {
    switch (operation) {
      case 'create':
        sandbox = await Sandbox.create(templateOrId, {
          timeoutMs: options.timeoutMs,
          envs: options.env,
        })
        break
      case 'connect':
        sandbox = await Sandbox.connect(templateOrId, { timeoutMs: options.timeoutMs })
        break
      case 'resume':
        // e2b SDK v2+: connect() auto-resumes paused sandboxes (Sandbox.resume removed).
        sandbox = await Sandbox.connect(templateOrId, { timeoutMs: options.timeoutMs })
        break
      default:
        throw new Error(`Unknown sandbox operation: ${operation}`)
    }

    return sandbox
  } catch (error) {
    throw error
  }
}

/** Dedupe concurrent prepareContainer calls (preview URL refetch stampede). */
const prepareInflight = new Map<string, Promise<ISandbox>>()

export type PrepareContainerOptions = {
  /** preview = resume/create + best-effort sync; skip long bun install. */
  mode?: 'full' | 'preview'
}

/**
 * Prepare and manage project container
 * Handle container creation, recovery, and file synchronization
 */
export async function prepareContainer(
  ctx: any,
  projectId: string,
  projectData: { containerId?: string; messageHistory: string },
  options: PrepareContainerOptions = {}
): Promise<any> {
  const existing = prepareInflight.get(projectId)
  if (existing) return existing

  // Register placeholder BEFORE awaiting anything (inner hits await early).
  let resolveOuter!: (value: ISandbox) => void
  let rejectOuter!: (reason?: unknown) => void
  const placeholder = new Promise<ISandbox>((resolve, reject) => {
    resolveOuter = resolve
    rejectOuter = reject
  })
  prepareInflight.set(projectId, placeholder)

  prepareContainerInner(ctx, projectId, projectData, options)
    .then(resolveOuter, rejectOuter)
    .finally(() => {
      if (prepareInflight.get(projectId) === placeholder) {
        prepareInflight.delete(projectId)
      }
    })

  return placeholder
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function prepareContainerInner(
  ctx: any,
  projectId: string,
  projectData: { containerId?: string; messageHistory: string },
  options: PrepareContainerOptions = {}
): Promise<ISandbox> {
  const mode = options.mode ?? 'full'
  const envProvider = env.NEXT_PUBLIC_SANDBOX_DEFAULT_PROVIDER as SandboxProviderType
  // Use unified configuration for template selection
  const TEMPLATE = TEMPLATE_MAPPINGS.getTemplateForProvider(envProvider || 'e2b', 'basic')

  // Get organization and user information
  const { orgId } = await requireOrgAndUser(ctx)
  const db = await getBusinessDb()

  // Determine user tier based on premium membership status
  const isPremium = await hasPremiumMembership(orgId)
  const userTier: 'FREE' | 'PAID' = isPremium ? 'PAID' : 'FREE'

  // Get dynamic timeout based on user tier
  const TIMEOUT_MS = getTimeoutForUserTier(userTier)

  const containerId = projectData.containerId?.trim()
  let container: ISandbox

  log.project('info', 'Preparing container', {
    orgId,
    projectId,
    operation: 'prepare-container',
    hasContainerId: Boolean(containerId),
  })

  if (containerId) {
    const [resumeResult, resumeError] = await tryCatch(async () =>
      getSandboxInstance('resume', containerId, { timeoutMs: TIMEOUT_MS })
    )

    if (resumeError) {
      // Check if this is a "not found" error - if so, create new instead of recovery
      if (isSandboxNotFoundError(resumeError)) {
        log.project('warn', 'Sandbox not found — creating new', {
          orgId,
          projectId,
          operation: 'prepare-container',
        })

        // Clear the old container ID and create new
        await db
          .update(project)
          .set({ containerId: "" })
          .where(eq(project.id, projectId))

        container = await createNewContainer(db, projectId, TEMPLATE, TIMEOUT_MS, orgId)
      } else {
        // For other errors, try recovery
        log.project(
          'warn',
          'Sandbox resume failed — recovering',
          { orgId, projectId, operation: 'prepare-container' },
          resumeError instanceof Error ? resumeError : new Error(String(resumeError))
        )
        container = await handleContainerRecovery(db, projectId, containerId, TEMPLATE, TIMEOUT_MS, orgId)
      }
    } else {
      container = resumeResult
    }
  } else {
    container = await createNewContainer(db, projectId, TEMPLATE, TIMEOUT_MS, orgId)
  }

  log.project('info', 'Syncing files to container', {
    orgId,
    projectId,
    operation: 'prepare-container',
    mode,
  })

  const syncMs = mode === 'preview' ? 12_000 : 60_000
  try {
    await withTimeout(
      syncFilesToContainer(container, projectData.messageHistory),
      syncMs,
      'syncFilesToContainer'
    )
  } catch (error) {
    log.project(
      'warn',
      'File sync skipped/failed — continuing to preview URL',
      { orgId, projectId, operation: 'prepare-container', mode },
      error instanceof Error ? error : new Error(String(error))
    )
  }

  try {
    await withTimeout(injectGeneratedAppDbEnv(container, projectId, orgId), 8_000, 'injectDbEnv')
  } catch (error) {
    log.project(
      'warn',
      'DB env inject skipped/failed',
      { orgId, projectId, operation: 'prepare-container', mode },
      error instanceof Error ? error : new Error(String(error))
    )
  }

  try {
    await withTimeout(ensureSandboxPreviewEmbedCsp(container, projectId), 12_000, 'previewEmbedCsp')
  } catch (error) {
    log.project(
      'warn',
      'Preview iframe CSP patch skipped/failed',
      { orgId, projectId, operation: 'prepare-container', mode },
      error instanceof Error ? error : new Error(String(error))
    )
  }

  if (mode === 'full') {
    await ensureSandboxDependencies(container, projectId)
  } else {
    // Best-effort: wake Vite without blocking the preview URL response.
    void tryCatch(async () => {
      const runner = container as {
        executeCommand?: (cmd: string, options?: { timeoutMs?: number }) => Promise<unknown>
      }
      if (typeof runner.executeCommand !== 'function') return
      const frameEnv = buildPreviewFrameEnvExports()
      await runner.executeCommand(
        `cd ${SANDBOX_APP_ROOT} && ${frameEnv} (pgrep -f vite >/dev/null 2>&1 || (nohup bun run dev --host 0.0.0.0 --port 5173 >/tmp/vite-preview.log 2>&1 &))`,
        { timeoutMs: 8_000 }
      )
    })
  }

  log.project('info', 'Container ready for preview', {
    orgId,
    projectId,
    operation: 'prepare-container',
    mode,
  })
  return container
}

/**
 * Install missing runtime deps and neutralize Preview killers (socket.io-client).
 * Always rewrite src/lib/socket.ts to a no-import stub so Vite can boot.
 * Also scrub legacy "QuickXBuild Ecommerce" Index if the E2B template image is stale.
 */
async function ensureSandboxDependencies(container: ISandbox, projectId: string): Promise<void> {
  const socketStub = `/**
 * Realtime is optional. This stub NEVER imports socket.io-client so Vite Preview
 * always boots even when node_modules is incomplete (common on resumed sandboxes).
 */
export type AppSocket = {
  auth?: { userId?: string }
  disconnect: () => void
  connect: () => void
}

export function getAppSocket(_userId?: string): AppSocket | undefined {
  return undefined
}

export async function ensureAppSocket(_userId?: string): Promise<AppSocket | undefined> {
  return undefined
}
`

  const indexNeutral = `import { Link } from "react-router-dom";

export default function Index() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-center text-3xl font-semibold tracking-tight">Your app is ready</h1>
      <p className="max-w-lg text-center text-muted-foreground">
        Describe what to build in chat. This starter screen will be replaced with your product.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <Link className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted" to="/about">About</Link>
        <Link className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted" to="/contact">Contact</Link>
      </div>
    </div>
  );
}
`

  const [, writeError] = await tryCatch(async () => {
    const files: Array<{ path: string; content: string; isBinary: boolean }> = [
      {
        path: `${SANDBOX_APP_ROOT}/src/lib/socket.ts`,
        content: socketStub,
        isBinary: false,
      },
    ]

    // Only scrub Index when it is still the legacy ecommerce starter — never wipe a real build.
    let scrubIndex = true
    try {
      if (typeof container.readFile === 'function') {
        const current = await container.readFile(`${SANDBOX_APP_ROOT}/src/pages/Index.tsx`)
        if (
          current &&
          !/QuickXBuild Ecommerce|Welcome to QuickXBuild Ecommerce|admin@admin\.com|browse the store/i.test(
            current
          )
        ) {
          scrubIndex = false
        }
      }
    } catch {
      scrubIndex = true
    }
    if (scrubIndex) {
      files.push({
        path: `${SANDBOX_APP_ROOT}/src/pages/Index.tsx`,
        content: indexNeutral,
        isBinary: false,
      })
    }

    if (container.writeFiles && typeof container.writeFiles === 'function') {
      const result = await container.writeFiles(files)
      if (!result.success) {
        throw new Error('Failed to write sandbox bootstrap files')
      }
      return
    }
    throw new Error('Container does not support file writing')
  })

  if (writeError) {
    log.project(
      'warn',
      'Failed to write sandbox bootstrap files',
      { projectId, operation: 'ensure-sandbox-deps' },
      writeError instanceof Error ? writeError : new Error(String(writeError))
    )
  }

  // Socket is stubbed above — do not bun-add on every preview refresh (hangs getPreviewUrl).
  // Only install when node_modules is missing, with a hard timeout.
  const cmd = `cd ${SANDBOX_APP_ROOT} && if [ ! -d node_modules ]; then bun install; fi`
  const DEP_TIMEOUT_MS = 45_000

  const [, error] = await tryCatch(async () => {
    const runner = container as {
      executeCommand?: (cmd: string, options?: { timeoutMs?: number }) => Promise<unknown>
      commands?: { run: (cmd: string) => Promise<unknown> }
    }
    if (typeof runner.executeCommand === 'function') {
      await runner.executeCommand(cmd, { timeoutMs: DEP_TIMEOUT_MS })
      return
    }
    if (runner.commands?.run) {
      await Promise.race([
        runner.commands.run(cmd),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Sandbox dependency ensure timed out')), DEP_TIMEOUT_MS)
        ),
      ])
      return
    }
    throw new Error('Container does not support executeCommand')
  })

  if (error) {
    log.project(
      'warn',
      'Sandbox dependency ensure failed',
      { projectId, operation: 'ensure-sandbox-deps' },
      error instanceof Error ? error : new Error(String(error))
    )
  }
}

/**
 * Handle container recovery failure cases
 */
async function handleContainerRecovery(
  db: any,
  projectId: string,
  oldContainerId: string,
  template: string,
  timeoutMs: number,
  orgId?: string
): Promise<any> {
  // Successfully acquired lock, create new sandbox
  return await createSandboxWithLock(db, projectId, template, timeoutMs, orgId)
}

/**
 * Create new container
 */
async function createNewContainer(
  db: any,
  projectId: string,
  template: string,
  timeoutMs: number,
  orgId?: string
): Promise<any> {
  // Successfully acquired lock, create new sandbox
  return await createSandboxWithLock(db, projectId, template, timeoutMs, orgId)
}

/**
 * Create Sandbox after acquiring lock
 */
async function createSandboxWithLock(
  db: any,
  projectId: string,
  template: string,
  timeoutMs: number,
  orgId?: string
): Promise<any> {
  const appEnv = orgId ? buildGeneratedAppDbEnv(projectId, orgId) : undefined

  const [sandbox, sandboxError] = await tryCatch(async () =>
    getSandboxInstance('create', template, { timeoutMs, env: appEnv })
  )

  if (sandboxError) {
    throw sandboxError
  }

  const containerId = sandbox.sandboxId || sandbox.id

  // Update to the actual containerId
  const [updateResult, updateError] = await tryCatch(async () =>
    db
      .update(project)
      .set({ containerId })
      .where(and(
        eq(project.id, projectId),
        or(isNull(project.containerId), eq(project.containerId, ''))
      ))
      .returning()
  )

  if (updateError) {
    // Clean up the placeholder on update failure
    // Destroy sandbox
    const sandboxId = sandbox.sandboxId || sandbox.id
    const [cleanupResult, cleanupError] = await tryCatch(async () =>
      terminateSandbox(sandboxId)
    )

    throw updateError
  }
  // Return the sandbox (already native instance from getSandboxInstance)
  return sandbox
}

const SANDBOX_APP_ROOT = '/home/user/vite-shadcn-template-quickxbuild'

/** Origins allowed to embed the Vite sandbox preview iframe. */
function getPreviewFrameAncestorOrigins(): string[] {
  const origins: string[] = []
  for (const raw of [
    process.env.PREVIEW_FRAME_ANCESTORS,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.PUBLIC_PREVIEW_URL,
  ]) {
    if (!raw?.trim()) continue
    for (const part of raw.trim().split(/\s+/)) {
      try {
        const origin = new URL(part).origin
        if (origin && !origins.includes(origin)) origins.push(origin)
      } catch {
        // ignore invalid
      }
    }
  }
  return origins
}

function buildPreviewFrameAncestorCsp(): string {
  const extras = getPreviewFrameAncestorOrigins()
  const parts = [
    "frame-ancestors 'self'",
    'http://localhost:*',
    'https://localhost:*',
    'http://127.0.0.1:*',
    'https://127.0.0.1:*',
    ...extras,
  ]
  // Always allow HTTPS parents so production builder UIs can iframe the preview
  // even when NEXT_PUBLIC_APP_URL was not injected into the sandbox process.
  if (!extras.some((origin) => origin.startsWith('https:'))) {
    parts.push('https:')
  } else if (!parts.includes('https:')) {
    parts.push('https:')
  }
  return parts.join(' ')
}

function buildPreviewFrameEnvExports(): string {
  const origins = getPreviewFrameAncestorOrigins()
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || origins[0] || '').replace(/\/$/, '')
  const ancestors = origins.join(' ')
  const parts: string[] = []
  if (appUrl) parts.push(`NEXT_PUBLIC_APP_URL=${JSON.stringify(appUrl)}`)
  if (ancestors) parts.push(`PREVIEW_FRAME_ANCESTORS=${JSON.stringify(ancestors)}`)
  return parts.length ? `${parts.join(' ')} ` : ''
}

/**
 * Patch sandbox Vite CSP so websitebuilder / production IDE can iframe the preview.
 * Without this, Vite defaults to localhost-only frame-ancestors → "refused to connect".
 */
async function ensureSandboxPreviewEmbedCsp(
  container: ISandbox,
  projectId: string
): Promise<void> {
  const csp = buildPreviewFrameAncestorCsp()
  const viteConfigPath = `${SANDBOX_APP_ROOT}/vite.config.ts`

  let config = ''
  try {
    if (typeof container.readFile === 'function') {
      config = await container.readFile(viteConfigPath)
    }
  } catch {
    config = ''
  }

  const restartViteWithFrameEnv = async () => {
    const runner = container as {
      executeCommand?: (cmd: string, options?: { timeoutMs?: number }) => Promise<unknown>
    }
    if (typeof runner.executeCommand !== 'function') return
    const frameEnv = buildPreviewFrameEnvExports()
    // Always exit 0 — pkill returns non-zero when vite is not running.
    await runner.executeCommand(
      `cd ${SANDBOX_APP_ROOT} && ${frameEnv} sh -c '(pkill -f "[v]ite" || true); sleep 1; nohup bun run dev --host 0.0.0.0 --port 5173 >/tmp/vite-preview.log 2>&1 & exit 0'`,
      { timeoutMs: 12_000 }
    )
  }

  if (!config) {
    try {
      await restartViteWithFrameEnv()
    } catch (error) {
      log.project(
        'warn',
        'Preview CSP vite restart skipped',
        { projectId, operation: 'preview-embed-csp' },
        error instanceof Error ? error : new Error(String(error))
      )
    }
    log.project('info', 'Preview CSP env applied (no vite.config read)', {
      projectId,
      operation: 'preview-embed-csp',
    })
    return
  }

  const replacement = `function frameAncestorCsp(): string {\n  return ${JSON.stringify(csp)}\n}`
  let next = config
  if (/function frameAncestorCsp\(\): string \{[\s\S]*?\n\}/.test(config)) {
    next = config.replace(/function frameAncestorCsp\(\): string \{[\s\S]*?\n\}/, replacement)
  } else if (config.includes('Content-Security-Policy')) {
    next = config.replace(
      /'Content-Security-Policy'\s*:\s*[^,\n]+/,
      `'Content-Security-Policy': ${JSON.stringify(csp)}`
    )
  } else {
    // Inject headers block into server config if missing
    next = config.replace(
      /server:\s*\{/,
      `server: {\n      headers: { 'Content-Security-Policy': ${JSON.stringify(csp)} },`
    )
  }

  if (next !== config && typeof container.writeFiles === 'function') {
    await container.writeFiles([
      {
        path: viteConfigPath,
        content: next,
        isBinary: false,
      },
    ])
  }

  try {
    await restartViteWithFrameEnv()
  } catch (error) {
    log.project(
      'warn',
      'Preview CSP vite restart skipped after config patch',
      { projectId, operation: 'preview-embed-csp' },
      error instanceof Error ? error : new Error(String(error))
    )
  }

  log.project('info', 'Preview iframe CSP patched for builder embed', {
    projectId,
    operation: 'preview-embed-csp',
    csp,
  })
}

/** Write Neon + data-proxy credentials into the sandbox and restart the app API. */
async function injectGeneratedAppDbEnv(
  container: ISandbox,
  projectId: string,
  orgId: string
): Promise<void> {
  const appEnv = buildGeneratedAppDbEnv(projectId, orgId)
  if (!appEnv.DATABASE_URL) {
    log.project('warn', 'POSTGRES_URL missing — generated app has no Neon database', {
      projectId,
      orgId,
      operation: 'inject-app-db-env',
    })
  }

  const envFile = formatEnvFile(appEnv)
  const files = [
    {
      path: `${SANDBOX_APP_ROOT}/.env`,
      content: envFile,
      isBinary: false,
    },
    {
      path: `${SANDBOX_APP_ROOT}/.dev.vars`,
      content: envFile,
      isBinary: false,
    },
  ]

  const [, writeError] = await tryCatch(async () => {
    if (container.writeFiles && typeof container.writeFiles === 'function') {
      const result = await container.writeFiles(files)
      if (!result.success) {
        throw new Error('Failed to write generated app DB env files')
      }
      return
    }
    throw new Error('Container does not support file writing')
  })

  if (writeError) {
    log.project(
      'warn',
      'Failed to write Neon env into sandbox',
      { projectId, operation: 'inject-app-db-env' },
      writeError instanceof Error ? writeError : new Error(String(writeError))
    )
    return
  }

  // Restart API with Neon env so signup/login hit the project schema.
  const exportPrefix = Object.entries(appEnv)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(' ')
  const restartCmd = [
    `cd ${SANDBOX_APP_ROOT}`,
    'pkill -f "server/index.ts" || true',
    'pkill -f "server:dev" || true',
    `nohup env ${exportPrefix} bun run server/index.ts > /tmp/app-api.log 2>&1 &`,
  ].join(' && ')

  const [, restartError] = await tryCatch(async () => {
    if (typeof (container as { executeCommand?: (cmd: string) => Promise<unknown> }).executeCommand === 'function') {
      await (container as { executeCommand: (cmd: string) => Promise<unknown> }).executeCommand(restartCmd)
      return
    }
    const anyContainer = container as {
      commands?: { run: (cmd: string) => Promise<unknown> }
      container?: { commands?: { run: (cmd: string) => Promise<unknown> } }
    }
    if (anyContainer.commands?.run) {
      await anyContainer.commands.run(restartCmd)
      return
    }
    if (anyContainer.container?.commands?.run) {
      await anyContainer.container.commands.run(restartCmd)
    }
  })

  if (restartError) {
    log.project(
      'warn',
      'Wrote Neon env but failed to restart generated app API',
      { projectId, operation: 'inject-app-db-env' },
      restartError instanceof Error ? restartError : new Error(String(restartError))
    )
  } else {
    log.project('info', 'Injected Neon Postgres into generated app sandbox', {
      projectId,
      orgId,
      schema: appEnv.APP_SCHEMA,
      operation: 'inject-app-db-env',
    })
  }
}

/**
 * Synchronize files to container
 */
async function syncFilesToContainer(container: ISandbox, messageHistory: string): Promise<void> {
  const [, syncError] = await tryCatch(async () => {
    const initFiles = templateConfigs.vite as FileStructure
    const history = parseMessageHistory(messageHistory)
    const { fileMap } = buildFilesWithHistory(initFiles, history) || { fileMap: {} }

    const filesToWrite = Object.entries(fileMap)
      .filter(([path]) => !isExcludedFile(path))
      .map(([path, fileInfo]) => ({
        path: `/home/user/vite-shadcn-template-quickxbuild/${path}`,
        data:
          fileInfo.type === 'file' && !fileInfo.isBinary
            ? fileInfo.content
            : JSON.stringify(fileInfo.content),
      }))

    // Check if container is an abstraction layer instance (ISandbox)
    if (container.writeFiles && typeof container.writeFiles === 'function') {
      // Use abstraction layer method
      const sandboxFiles = filesToWrite.map(file => ({
        path: file.path,
        content: file.data,
        isBinary: false
      }))

      const result = await container.writeFiles(sandboxFiles)

      // Check for errors in the result
      if (!result.success) {
        const errorDetails = result.results
          .filter((r: { success: boolean }) => !r.success)
          .map((r: { path?: string; error?: string }) => `${r.path || 'Unknown path'}: ${r.error || 'Unknown error'}`)
          .join(', ')
        throw new Error(`Failed to sync files: ${errorDetails}`)
      }
    }
    // Fallback for native E2B container
    // else if (container.files && container.files.write) {
    //   await container.files.write(filesToWrite)
    // }
    // No supported file writing method
    else {
      throw new Error('Container does not support file writing operations')
    }
  })

  if (syncError) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to sync files to container',
    })
  }
}

function getLocalPreviewRoot(): string {
  return process.env.LOCAL_PREVIEW_ROOT
    || path.resolve(process.cwd(), '../vite-shadcn-template')
}

function isSafeLocalPreviewPath(root: string, relativePath: string): boolean {
  if (relativePath.includes('\0') || path.isAbsolute(relativePath)) {
    return false
  }

  const normalized = relativePath.replace(/\\/g, '/')
  if (normalized.startsWith('../') || normalized.split('/').includes('..')) {
    return false
  }

  const allowedPrefixes = ['src/', 'public/', 'server/']
  const allowedFiles = new Set(['index.html'])
  if (!allowedFiles.has(normalized) && !allowedPrefixes.some((prefix) => normalized.startsWith(prefix))) {
    return false
  }

  const resolved = path.resolve(root, normalized)
  const rootResolved = path.resolve(root)
  return resolved.startsWith(`${rootResolved}${path.sep}`) || resolved === rootResolved
}

/**
 * Write generated project files into the local Vite template so the
 * development iframe can preview AI changes without a cloud sandbox.
 */
export async function syncFilesToLocalPreview(messageHistory: string): Promise<{
  written: number
  serverChanged: boolean
}> {
  const root = getLocalPreviewRoot()
  const initFiles = templateConfigs.vite as FileStructure
  const history = parseMessageHistory(messageHistory)
  const { fileMap } = buildFilesWithHistory(initFiles, history) || { fileMap: {} }
  let written = 0
  let serverChanged = false

  for (const [relativePath, fileInfo] of Object.entries(fileMap)) {
    if (isExcludedFile(relativePath) || fileInfo.type !== 'file' || fileInfo.isBinary) {
      continue
    }
    if (!isSafeLocalPreviewPath(root, relativePath)) {
      continue
    }

    const destination = path.resolve(root, relativePath)
    await mkdir(path.dirname(destination), { recursive: true })
    let content = typeof fileInfo.content === 'string'
      ? fileInfo.content
      : JSON.stringify(fileInfo.content)
    if (relativePath.replace(/\\/g, '/') === 'index.html') {
      content = content.replace(
        /<script type="module">[\s\S]*?inspect\.js[\s\S]*?<\/script>\s*/g,
        ''
      )
    }
    await writeFile(destination, content, 'utf8')
    written += 1
    if (relativePath.replace(/\\/g, '/').startsWith('server/')) {
      serverChanged = true
    }
  }

  log.project('info', 'Synced generated files to local preview', {
    root,
    written,
    serverChanged,
    operation: 'local-preview-sync',
  })

  return { written, serverChanged }
}

/**
 * Check if an error is retryable
 */
function isRetryableError(error: any): boolean {
  if (!error) return false

  const errorMessage = error.message?.toLowerCase() || ''
  const errorCode = error.code || error.status

  // Network errors are retryable
  if (
    errorMessage.includes('network') ||
    errorMessage.includes('timeout') ||
    errorMessage.includes('connection') ||
    errorMessage.includes('econnreset') ||
    errorMessage.includes('enotfound')
  ) {
    return true
  }

  // HTTP status codes that are retryable
  if (
    errorCode === 429 || // Rate limit
    errorCode === 502 || // Bad gateway
    errorCode === 503 || // Service unavailable
    errorCode === 504
  ) {
    // Gateway timeout
    return true
  }

  // E2B specific retryable errors
  if (errorMessage.includes('rate limit') || errorMessage.includes('temporarily unavailable')) {
    return true
  }

  return false
}

/**
 * Calculate retry delay with exponential backoff
 */
function getRetryDelay(retryCount: number): number {
  // Base delay of 1 second, exponentially increasing
  const baseDelay = 1000
  const maxDelay = 30000 // Max 30 seconds

  const delay = Math.min(baseDelay * 2 ** retryCount, maxDelay)

  // Add some jitter to avoid thundering herd
  const jitter = Math.random() * 0.1 * delay

  return Math.floor(delay + jitter)
}

/**
 * Terminate a sandbox and clean up resources
 */
export async function terminateSandbox(
  containerId: string,
  options: TerminationOptions = {}
): Promise<SandboxCleanupResult> {
  // Use unified configuration for default timeout
  const { timeoutMs = CONTAINER_TIMEOUTS.API_DEFAULT, retryCount = 0, maxRetries = 3 } = options

  if (!containerId || containerId.startsWith('pending-')) {
    return {
      success: true,
      containerId,
      error: 'Placeholder container ID, no actual sandbox to terminate',
    }
  }

  const [result, terminationError] = await tryCatch(async () => {
    // Try to use abstraction layer first
    const factoryAvailable = await ensureSandboxFactory()

    if (factoryAvailable) {
      try {
        const factory = getSandboxFactory()
        const terminationResult = await factory.getProvider(getDefaultSandboxProvider()).terminate(containerId, {
          timeoutMs,
          retryCount,
          maxRetries
        })
        return terminationResult
      } catch (abstractionError) {
        // Abstraction layer termination failed, falling back to direct E2B
      }
    }

    // Fallback to direct E2B termination
    await Sandbox.kill(containerId, { requestTimeoutMs: timeoutMs })
    return { success: true, sandboxId: containerId }
  })

  if (terminationError) {

    // Determine if this is a retryable error
    const isRetryable = isRetryableError(terminationError)

    if (isRetryable && retryCount < maxRetries) {
      // Wait before retry with exponential backoff
      await new Promise((resolve) => setTimeout(resolve, getRetryDelay(retryCount)))

      return terminateSandbox(containerId, {
        ...options,
        retryCount: retryCount + 1,
      })
    }

    return {
      success: false,
      containerId,
      error: terminationError.message || 'Unknown termination error',
    }
  }

  if (result?.success) {
    return {
      success: true,
      containerId,
      error: result.error
    }
  }

  return {
    success: true,
    containerId,
    error: 'Sandbox not found or already terminated',
  }
}

/**
 * Verify that a sandbox has been properly cleaned up
 */
export async function verifySandboxCleanup(
  containerId: string,
  timeoutMs = 10_000
): Promise<boolean> {
  if (!containerId || containerId.startsWith('pending-')) {
    // Placeholder IDs don't have actual sandboxes
    return true
  }

  const [sandboxList, listError] = await tryCatch(async () => {
    // Try to use abstraction layer first
    const factoryAvailable = await ensureSandboxFactory()

    if (factoryAvailable) {
      try {
        const factory = getSandboxFactory()
        const sandboxes = await factory.getProvider(getDefaultSandboxProvider()).list()
        return sandboxes
      } catch (abstractionError) {
        // Abstraction layer list failed, falling back to direct E2B
      }
    }

    // Fallback to direct E2B listing
    return Sandbox.list({ requestTimeoutMs: timeoutMs })
  })

  if (listError) {
    // If we can't verify, assume cleanup failed
    return false
  }

  // Check if the sandbox still exists in the list
  const [sandboxExists, checkError] = await tryCatch(async () => {
    if (sandboxList && Array.isArray(sandboxList)) {
      // Abstraction layer returns array directly
      return sandboxList.some(
        (sandbox: any) => sandbox.id === containerId
      )
    }

    if (sandboxList && typeof sandboxList === 'object') {
      // Direct E2B returns a paginator, we need to get the items
      const items = (sandboxList as any).items || sandboxList
      if (Array.isArray(items)) {
        return items.some(
          (sandbox: any) => sandbox.sandboxId === containerId || sandbox.id === containerId
        )
      }
    }

    return false
  })

  if (checkError) {
    return false
  }

  if (sandboxExists) {
    return false
  }

  return true
}

/**
 * Helper function to handle async screenshot operation with proper waitUntil
 * Uses prepareContainer to ensure sandbox state reflects complete message history
 */
export const handleAsyncScreenshot = async (
  ctx: any,
  projectId: string,
  planId: string,
  organizationId: string,
  previewInfo: any
) => {
  if (!previewInfo?.url) {
      throw new Error('Failed to get preview URL from prepared container')
  }
  const screenshotPromise = (async () => {
      try {
          // Prepare request headers for authentication
          const requestHeaders: HeadersInit = {}

          if (ctx.headers) {
              const cookieHeader = ctx.headers.get('cookie')
              if (cookieHeader) {
                  (requestHeaders as Record<string, string>).cookie = cookieHeader
              }

              const authHeader = ctx.headers.get('authorization')
              if (authHeader) {
                  (requestHeaders as Record<string, string>).authorization = authHeader
              }
          }

          // Call screenshot service with prepared preview URL
          return await captureAndStoreScreenshot({
              projectId,
              planId,
              userId: ctx.session.user.id,
              organizationId: organizationId,
              requestHeaders,
              previewUrl: previewInfo.url
          })
      } catch (error) {
          throw error
      }
  })

  try {
      // Try to use Cloudflare Workers waitUntil
      const cloudflareContext = await getCloudflareContext({async: true})
      const executionContext = cloudflareContext.ctx

      if (executionContext?.waitUntil) {
          executionContext.waitUntil(screenshotPromise())
          return
      }
  } catch (contextError) {
      // Cloudflare context not available, using Promise fallback
  }
}