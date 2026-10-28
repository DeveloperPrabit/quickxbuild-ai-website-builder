/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * project-sandbox.ts — Resolve the sandbox filesystem for Agent Runtime (Phase 2/3/4)
 *
 * Authoritative Environment Architecture:
 * - Local filesystem (localRoot) is the primary authoritative execution environment.
 * - All development commands (install, build, typecheck, preview_health) execute
 *   with cwd = path.resolve(sandbox.root).
 * - Sandboxes are initialized with the authoritative project tree (context.fileMap),
 *   guaranteeing that package.json, vite.config.ts, tsconfig, source files, and dependencies
 *   are present before any build or tool pass runs.
 * - Optional cloud containers (E2B / Daytona) are mirrored during writes when containerId
 *   is present, but local execution remains the authoritative source of truth.
 *
 * Preference order:
 * 1. LOCAL_PREVIEW_ROOT / AGENT_SANDBOX_ROOT — real project preview disk
 * 2. Per-project directory under os.tmpdir() — isolated authoritative filesystem
 * 3. Optional cloud mirror (E2B/Daytona) when containerId is available
 */

import { access, mkdir, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  createCloudSandboxFilesystem,
  createCompositeSandboxFilesystem,
  createLocalSandboxFilesystem,
  resolveDefaultLocalSandboxRoot,
  type SandboxFilesystem,
} from './sandbox-fs'

const SANDBOX_APP_ROOT = '/home/user/vite-shadcn-template-quickxbuild'

export type InitialSandboxFiles =
  | Record<
      string,
      { content?: string | null; isBinary?: boolean; type?: string } | string | null | undefined
    >
  | null
  | undefined

export async function resolveProjectSandboxFilesystem(input: {
  projectId: string
  containerId?: string | null
  initialFiles?: InitialSandboxFiles
}): Promise<SandboxFilesystem> {
  const envRoot = resolveDefaultLocalSandboxRoot()
  // Shared local preview root matches syncFilesToLocalPreview; otherwise isolate by project.
  const localRoot = envRoot
    ? envRoot
    : path.join(os.tmpdir(), 'quickxbuild-agent-sandbox', input.projectId)

  await mkdir(localRoot, { recursive: true })
  const local = createLocalSandboxFilesystem(localRoot)

  // Seed authoritative project files (package.json, vite.config.ts, source files, tsconfig, etc.)
  if (input.initialFiles) {
    await seedSandboxFiles(local, input.initialFiles)
  }

  // Ensure node_modules exists so commands like bun run build / vite can execute in localRoot
  await tryEnsureNodeModules(localRoot)

  if (!input.containerId) {
    return local
  }

  const cloud = await tryCreateCloudSandboxFilesystem(input.containerId)
  if (!cloud) return local
  return createCompositeSandboxFilesystem(local, cloud)
}

/**
 * Seed initial project files into the sandbox filesystem.
 * Guarantees the sandbox contains the complete project tree required for install/build/preview.
 */
async function seedSandboxFiles(
  sandbox: SandboxFilesystem,
  initialFiles: InitialSandboxFiles
): Promise<void> {
  if (!initialFiles) return

  for (const [relativePath, fileInfo] of Object.entries(initialFiles)) {
    if (!relativePath || fileInfo == null) continue
    const cleanPath = relativePath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '')
    if (
      !cleanPath ||
      cleanPath.startsWith('.git/') ||
      cleanPath.includes('\0') ||
      cleanPath.startsWith('../') ||
      cleanPath.split('/').includes('..')
    ) {
      continue
    }

    if (typeof fileInfo === 'string') {
      await sandbox.writeFile(cleanPath, fileInfo)
      continue
    }

    if (typeof fileInfo === 'object') {
      if (fileInfo.isBinary || fileInfo.type === 'directory' || fileInfo.type === 'dir') {
        continue
      }
      let content: string | null = null
      if (typeof fileInfo.content === 'string') {
        content = fileInfo.content
      } else {
        const maybeCode = (fileInfo as { code?: string }).code
        if (typeof maybeCode === 'string') {
          content = maybeCode
        }
      }

      if (content !== null) {
        await sandbox.writeFile(cleanPath, content)
      }
    }
  }
}

/**
 * Check if node_modules is accessible in localRoot; if not, attempt to link/junction
 * from candidate template or monorepo node_modules directories.
 */
async function tryEnsureNodeModules(localRoot: string): Promise<void> {
  const targetLink = path.join(localRoot, 'node_modules')
  try {
    await access(targetLink)
    return
  } catch {
    // not present, search candidates
  }

  const candidates = [
    path.resolve(process.cwd(), 'apps/vite-shadcn-template/node_modules'),
    path.resolve(process.cwd(), 'node_modules'),
    path.resolve(process.cwd(), '../vite-shadcn-template/node_modules'),
    path.resolve(process.cwd(), '../../apps/vite-shadcn-template/node_modules'),
    path.resolve(process.cwd(), '../../node_modules'),
  ]

  for (const candidate of candidates) {
    try {
      await access(candidate)
      await symlink(candidate, targetLink, process.platform === 'win32' ? 'junction' : 'dir')
      return
    } catch {
      // try next candidate
    }
  }
}

async function tryCreateCloudSandboxFilesystem(
  containerId: string
): Promise<SandboxFilesystem | null> {
  try {
    const { getSandboxFactory, initializeSandboxFactory, createConfigFromEnvironment } =
      await import('@quickxbuild/sandbox')

    try {
      await initializeSandboxFactory(createConfigFromEnvironment())
    } catch {
      // Factory may already be initialized.
    }

    const factory = getSandboxFactory()
    const provider =
      (process.env.NEXT_PUBLIC_SANDBOX_DEFAULT_PROVIDER as 'e2b' | 'daytona' | undefined) || 'e2b'
    const sandbox = await factory.resumeSandbox(containerId, provider)
    if (!sandbox?.writeFiles) return null

    return createCloudSandboxFilesystem(sandbox, {
      appRoot: SANDBOX_APP_ROOT,
      rootLabel: `cloud:${containerId}`,
    })
  } catch {
    return null
  }
}
