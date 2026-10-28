/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * sandbox-fs.ts — Sandbox filesystem adapters (Phase 2)
 *
 * The sandbox filesystem is the Agent Runtime source of truth.
 * LocalFsSandboxFilesystem uses a real directory (temp or LOCAL_PREVIEW_ROOT).
 * Cloud adapters wrap ISandbox.writeFiles for E2B/Daytona.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export type SandboxFilesystem = {
  /** Absolute or logical root identifier (for diagnostics). */
  readonly root: string
  writeFile(relativePath: string, content: string): Promise<void>
  readFile(relativePath: string): Promise<string | null>
}

function assertSafeRelativePath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\//, '')
  if (!normalized || normalized.includes('\0') || path.isAbsolute(normalized)) {
    throw new Error(`Unsafe sandbox path: ${relativePath}`)
  }
  if (normalized.startsWith('../') || normalized.split('/').includes('..')) {
    throw new Error(`Unsafe sandbox path: ${relativePath}`)
  }
  return normalized
}

/**
 * Real on-disk sandbox root — used by Phase 2 acceptance tests and local preview.
 */
export function createLocalSandboxFilesystem(rootDir: string): SandboxFilesystem {
  const root = path.resolve(rootDir)

  return {
    root,
    async writeFile(relativePath, content) {
      const safe = assertSafeRelativePath(relativePath)
      const destination = path.resolve(root, safe)
      if (!destination.startsWith(root + path.sep) && destination !== root) {
        throw new Error(`Path escapes sandbox root: ${relativePath}`)
      }
      await mkdir(path.dirname(destination), { recursive: true })
      await writeFile(destination, content, 'utf8')
    },
    async readFile(relativePath) {
      const safe = assertSafeRelativePath(relativePath)
      const destination = path.resolve(root, safe)
      if (!destination.startsWith(root + path.sep) && destination !== root) {
        throw new Error(`Path escapes sandbox root: ${relativePath}`)
      }
      try {
        return await readFile(destination, 'utf8')
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code
        if (code === 'ENOENT') return null
        throw error
      }
    },
  }
}

export type CloudSandboxWriter = {
  writeFiles: (
    files: Array<{ path: string; content: string; isBinary?: boolean }>
  ) => Promise<{ success: boolean; errorCount?: number }>
}

const DEFAULT_SANDBOX_APP_ROOT = '/home/user/vite-shadcn-template-quickxbuild'

/**
 * Wrap a cloud ISandbox-like writer. Paths are project-relative; prefixed with app root.
 */
export function createCloudSandboxFilesystem(
  sandbox: CloudSandboxWriter,
  options?: { appRoot?: string; rootLabel?: string }
): SandboxFilesystem {
  const appRoot = (options?.appRoot || DEFAULT_SANDBOX_APP_ROOT).replace(/\/$/, '')

  return {
    root: options?.rootLabel || appRoot,
    async writeFile(relativePath, content) {
      const safe = assertSafeRelativePath(relativePath)
      const absolute = `${appRoot}/${safe}`
      const result = await sandbox.writeFiles([
        { path: absolute, content, isBinary: false },
      ])
      if (!result.success) {
        throw new Error(`Cloud sandbox write failed for ${safe}`)
      }
    },
    async readFile() {
      // Cloud read is optional for Phase 2 mutation path; return null when unsupported.
      return null
    },
  }
}

/**
 * Compose an authoritative primary sandbox with optional mirrors.
 *
 * Primary write success = mutation persisted (runtime source of truth).
 * Mirror failures are logged and must NOT fail the authoritative local write.
 */
export function createCompositeSandboxFilesystem(
  primary: SandboxFilesystem,
  ...mirrors: SandboxFilesystem[]
): SandboxFilesystem {
  return {
    root: primary.root,
    async writeFile(relativePath, content) {
      // Authoritative sandbox first — success here means persistedToSandbox.
      await primary.writeFile(relativePath, content)
      for (const mirror of mirrors) {
        try {
          await mirror.writeFile(relativePath, content)
        } catch (error) {
          console.warn('[AgentRuntime] optional cloud sandbox mirror failed', {
            path: relativePath,
            primaryRoot: primary.root,
            mirrorRoot: mirror.root,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    },
    async readFile(relativePath) {
      return primary.readFile(relativePath)
    },
  }
}

/** Resolve default local preview / agent sandbox root from env. */
export function resolveDefaultLocalSandboxRoot(): string | null {
  if (process.env.AGENT_SANDBOX_ROOT) {
    return path.resolve(process.env.AGENT_SANDBOX_ROOT)
  }
  if (process.env.LOCAL_PREVIEW_ROOT) {
    return path.resolve(process.env.LOCAL_PREVIEW_ROOT)
  }
  return null
}
