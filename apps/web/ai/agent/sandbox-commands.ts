/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * sandbox-commands.ts — Allowlisted sandbox command execution (Phase 3)
 *
 * NOT arbitrary shell. Only structured allowlisted development commands.
 */

import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import path from 'node:path'
import type { SandboxFilesystem } from './sandbox-fs'

export type SandboxCommandResult = {
  command: string
  args: string[]
  cwd: string
  exitCode: number
  stdout: string
  stderr: string
  durationMs: number
  ok: boolean
}

/** Allowlisted command kinds for Agent Runtime. */
export type AllowlistedCommandKind =
  | 'install'
  | 'build'
  | 'typecheck'
  | 'test'
  | 'verify_dev'
  | 'preview_health'

export type AllowlistedCommandSpec = {
  kind: AllowlistedCommandKind
  /** Executable: bun | npm | pnpm | yarn | node */
  bin: string
  args: string[]
}

const DEPENDENCY_PATHS = new Set([
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
])

export function isDependencyPath(filePath: string): boolean {
  const base = filePath.replace(/\\/g, '/').replace(/^\.\//, '').split('/').pop() || ''
  return DEPENDENCY_PATHS.has(base) || filePath.replace(/\\/g, '/').endsWith('/package.json')
}

export function dependenciesChanged(writtenPaths: string[]): boolean {
  return writtenPaths.some((p) => isDependencyPath(p))
}

/**
 * Detect package manager from lockfiles in the sandbox root.
 * Prefers Bun (repo standard), then pnpm, yarn, npm.
 */
export async function detectPackageManager(
  sandboxRoot: string
): Promise<'bun' | 'pnpm' | 'yarn' | 'npm'> {
  const has = async (name: string) => {
    try {
      await access(path.join(sandboxRoot, name))
      return true
    } catch {
      return false
    }
  }
  if (await has('bun.lockb') || (await has('bun.lock'))) return 'bun'
  if (await has('pnpm-lock.yaml')) return 'pnpm'
  if (await has('yarn.lock')) return 'yarn'
  return 'bun' // QuickXBuild monorepo / template default
}

/** Build install command for the detected PM (no arbitrary packages via shell). */
export async function buildInstallCommand(
  sandboxRoot: string,
  packages?: string[]
): Promise<AllowlistedCommandSpec> {
  const pm = await detectPackageManager(sandboxRoot)
  if (packages && packages.length > 0) {
    // Only allow package name tokens: @scope/name or name with optional version
    const safe = packages.filter((p) => /^(@[\w.-]+\/)?[\w.-]+(@[\w.^~>=<\d.-]+)?$/.test(p))
    if (safe.length !== packages.length) {
      throw new Error('Rejected unsafe package name in install_packages')
    }
    if (pm === 'bun') return { kind: 'install', bin: 'bun', args: ['add', ...safe] }
    if (pm === 'pnpm') return { kind: 'install', bin: 'pnpm', args: ['add', ...safe] }
    if (pm === 'yarn') return { kind: 'install', bin: 'yarn', args: ['add', ...safe] }
    return { kind: 'install', bin: 'npm', args: ['install', ...safe] }
  }
  if (pm === 'bun') return { kind: 'install', bin: 'bun', args: ['install'] }
  if (pm === 'pnpm') return { kind: 'install', bin: 'pnpm', args: ['install'] }
  if (pm === 'yarn') return { kind: 'install', bin: 'yarn', args: ['install'] }
  return { kind: 'install', bin: 'npm', args: ['ci'] }
}

/** Build command from package.json scripts.build or vite build fallback. */
export async function buildBuildCommand(
  sandbox: SandboxFilesystem
): Promise<AllowlistedCommandSpec> {
  const pkgRaw = await sandbox.readFile('package.json')
  let script = 'vite build'
  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw) as { scripts?: { build?: string } }
      if (pkg.scripts?.build) {
        script = pkg.scripts.build
      }
    } catch {
      // keep default
    }
  }
  // Only allow known safe build script patterns via bun/npm run
  const pm = await detectPackageManager(sandbox.root)
  if (pm === 'bun') return { kind: 'build', bin: 'bun', args: ['run', 'build'] }
  if (pm === 'pnpm') return { kind: 'build', bin: 'pnpm', args: ['run', 'build'] }
  if (pm === 'yarn') return { kind: 'build', bin: 'yarn', args: ['run', 'build'] }
  return { kind: 'build', bin: 'npm', args: ['run', 'build'] }
}

/**
 * Resolve a structured allowlisted command from a kind + optional packages.
 * Rejects unknown kinds and shell metacharacters.
 */
export function resolveAllowlistedCommand(
  kind: string,
  options?: { packages?: string[]; pm?: 'bun' | 'pnpm' | 'yarn' | 'npm' }
): AllowlistedCommandSpec {
  const pm = options?.pm || 'bun'
  switch (kind) {
    case 'install':
    case 'bun_install':
      if (options?.packages?.length) {
        const safe = options.packages.filter((p) =>
          /^(@[\w.-]+\/)?[\w.-]+(@[\w.^~>=<\d.-]+)?$/.test(p)
        )
        if (safe.length !== options.packages.length) {
          throw new Error('Command rejected: unsafe package name')
        }
        return { kind: 'install', bin: pm === 'npm' ? 'npm' : pm, args: pm === 'npm' ? ['install', ...safe] : ['add', ...safe] }
      }
      return {
        kind: 'install',
        bin: pm === 'npm' ? 'npm' : pm,
        args: pm === 'npm' ? ['ci'] : ['install'],
      }
    case 'build':
    case 'vite_build':
      return { kind: 'build', bin: pm === 'npm' ? 'npm' : pm, args: ['run', 'build'] }
    case 'typecheck':
      return { kind: 'typecheck', bin: pm === 'npm' ? 'npm' : pm, args: ['run', 'typecheck'] }
    case 'test':
      return { kind: 'test', bin: pm === 'npm' ? 'npm' : pm, args: ['run', 'test'] }
    case 'verify_dev':
      // Short-lived production build check — never a long-running vite/dev server in the agent loop.
      return { kind: 'verify_dev', bin: pm === 'npm' ? 'npm' : pm, args: ['run', 'build'] }
    default:
      throw new Error(`Command rejected: '${kind}' is not allowlisted`)
  }
}

/** Reject free-form shell strings. */
export function assertNotArbitraryShell(command: string): void {
  if (/[;&|`$<>]/.test(command) || command.includes('\n')) {
    throw new Error('Command rejected: arbitrary shell metacharacters are not allowed')
  }
}

/**
 * Execute an allowlisted command in the sandbox root via spawn (no shell).
 */
export async function executeAllowlistedCommand(
  sandboxRoot: string,
  spec: AllowlistedCommandSpec,
  options?: { timeoutMs?: number; env?: NodeJS.ProcessEnv }
): Promise<SandboxCommandResult> {
  assertNotArbitraryShell(spec.bin)
  for (const arg of spec.args) {
    assertNotArbitraryShell(arg)
  }

  const cwd = path.resolve(sandboxRoot)
  const started = Date.now()
  const timeoutMs = options?.timeoutMs ?? 120_000

  return new Promise((resolve) => {
    const child = spawn(spec.bin, spec.args, {
      cwd,
      env: {
        ...process.env,
        ...options?.env,
        // Never pass through secrets into event logs — env is for process only
      },
      shell: false,
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      child.kill('SIGTERM')
      settled = true
      resolve({
        command: spec.bin,
        args: spec.args,
        cwd,
        exitCode: 124,
        stdout: redactSecrets(stdout),
        stderr: redactSecrets(stderr + '\n[timeout]'),
        durationMs: Date.now() - started,
        ok: false,
      })
    }, timeoutMs)

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
      if (stdout.length > 200_000) stdout = stdout.slice(-200_000)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
      if (stderr.length > 200_000) stderr = stderr.slice(-200_000)
    })

    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        command: spec.bin,
        args: spec.args,
        cwd,
        exitCode: 1,
        stdout: redactSecrets(stdout),
        stderr: redactSecrets(stderr || error.message),
        durationMs: Date.now() - started,
        ok: false,
      })
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const exitCode = code ?? 1
      resolve({
        command: spec.bin,
        args: spec.args,
        cwd,
        exitCode,
        stdout: redactSecrets(stdout),
        stderr: redactSecrets(stderr),
        durationMs: Date.now() - started,
        ok: exitCode === 0,
      })
    })
  })
}

/** Strip common secret patterns from command output before emitting events. */
export function redactSecrets(text: string): string {
  return text
    .replace(/(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*\S+/gi, '$1=[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [REDACTED]')
    .replace(/sk-[A-Za-z0-9]{10,}/g, '[REDACTED]')
}

export function formatCommandLabel(spec: AllowlistedCommandSpec): string {
  return [spec.bin, ...spec.args].join(' ')
}

/** Attach spawn-based executeCommand to a local sandbox filesystem. */
export function withLocalCommandExecution(
  sandbox: SandboxFilesystem
): SandboxFilesystem & {
  executeCommand: (
    spec: AllowlistedCommandSpec,
    options?: { timeoutMs?: number }
  ) => Promise<SandboxCommandResult>
} {
  return {
    ...sandbox,
    executeCommand: (spec, options) =>
      executeAllowlistedCommand(sandbox.root, spec, options),
  }
}
