/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * phase3-pipeline.ts — Install → build → diagnostic → repair → preview (Phase 3)
 *
 * Runs inside the SAME AgentRuntime under an already-held project mutation lock.
 * Does not create a separate Fix AI.
 */

import { acceptRuntimeWrites } from './accept-writes'
import { checkPreviewHealth, type PreviewHealthResult } from './preview-health'
import type { RuntimeEmitter } from './runtime-emitter'
import type { ViteDiagnostic } from './runtime-events'
import { type AgentRunGateResult, evaluateAgentRunGate } from './runtime-gate'
import {
  type AllowlistedCommandSpec,
  buildBuildCommand,
  buildInstallCommand,
  dependenciesChanged,
  executeAllowlistedCommand,
  formatCommandLabel,
  type SandboxCommandResult,
} from './sandbox-commands'
import type { SandboxFilesystem } from './sandbox-fs'
import type { PersistMutationFn } from './tools'
import { extractMissingPackage, normalizeViteDiagnostic } from './vite-diagnostics'
import type { AgentWrite } from './xml'

/** Max build attempts including initial + post-repair rebuilds. */
export const MAX_BUILD_ATTEMPTS = 3
/** Max automatic repair attempts per generation. */
export const MAX_REPAIR_ATTEMPTS = 2

export type Phase3CommandRunner = (
  sandboxRoot: string,
  spec: AllowlistedCommandSpec,
  options?: { timeoutMs?: number }
) => Promise<SandboxCommandResult>

export type Phase3RepairFn = (input: {
  diagnostic: ViteDiagnostic
  fileMap: Record<string, { content?: string }>
  attempt: number
}) => Promise<AgentWrite[]>

/**
 * Primary repair: continue the SAME AgentRuntime (streamText + tools + same planId).
 * Writes returned here should already be sandbox-persisted via persistMutation tools.
 */
export type Phase3RuntimeRepairFn = (input: {
  diagnostic: ViteDiagnostic
  fileMap: Record<string, { content?: string }>
  attempt: number
}) => Promise<{ writes: AgentWrite[]; alreadyPersisted: boolean }>

export type Phase3PipelineInput = {
  projectId: string
  planId: string
  sandbox: SandboxFilesystem
  emitter: RuntimeEmitter
  persistMutation: PersistMutationFn
  fileMap: Record<string, { content?: string }>
  writtenPaths: string[]
  abortSignal?: AbortSignal
  /** Injected command runner (tests). Defaults to real spawn. */
  runCommand?: Phase3CommandRunner
  /** Injected preview health (tests). */
  checkPreview?: (url?: string) => Promise<PreviewHealthResult>
  /**
   * Primary: SAME AgentRuntime continuation (model + tools).
   * Prefer this over repairFn / heuristics.
   */
  repairWithRuntime?: Phase3RuntimeRepairFn
  /** Narrow test/fallback inject — not the production primary path. */
  repairFn?: Phase3RepairFn
  previewUrl?: string
  onProgress?: (message: string) => void
}

export type Phase3PipelineResult = {
  gate: AgentRunGateResult
  installRequired: boolean
  installOk: boolean
  buildOk: boolean
  previewHealthOk: boolean
  writesOk: boolean
  diagnostics: ViteDiagnostic[]
  repairAttempts: number
  buildAttempts: number
}

function aborted(signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted)
}

/**
 * Phase 3: install (if needed) → build → diagnose → repair (same runtime) → rebuild → preview.
 * Caller MUST hold withProjectMutationLock for projectId.
 */
export async function runPhase3InstallBuildRepair(
  input: Phase3PipelineInput
): Promise<Phase3PipelineResult> {
  const runCommand = input.runCommand || executeAllowlistedCommand
  const diagnostics: ViteDiagnostic[] = []
  let installRequired = dependenciesChanged(input.writtenPaths)
  let installOk = !installRequired
  let buildOk = false
  let previewHealthOk = false
  let repairAttempts = 0
  let buildAttempts = 0
  const writesOk = input.writtenPaths.length > 0

  const emitCommand = async (
    spec: AllowlistedCommandSpec,
    packages?: string[]
  ): Promise<SandboxCommandResult> => {
    const label = formatCommandLabel(spec)
    input.emitter.emit({
      type: 'command_start',
      data: { command: label, packages },
    })
    input.emitter.toolStart(spec.kind === 'install' ? 'install_packages' : 'execute_command')
    const result = await runCommand(input.sandbox.root, spec)
    if (result.stdout) {
      input.emitter.emit({
        type: 'command_output',
        data: {
          command: label,
          stream: 'stdout',
          chunk: result.stdout.slice(0, 4000),
        },
      })
    }
    if (result.stderr) {
      input.emitter.emit({
        type: 'command_output',
        data: {
          command: label,
          stream: 'stderr',
          chunk: result.stderr.slice(0, 4000),
        },
      })
    }
    input.emitter.emit({
      type: 'command_result',
      data: {
        command: label,
        exitCode: result.exitCode,
        stdout: result.stdout.slice(0, 8000),
        stderr: result.stderr.slice(0, 8000),
        durationMs: result.durationMs,
      },
    })
    input.emitter.toolResult(
      spec.kind === 'install' ? 'install_packages' : 'execute_command',
      result.ok,
      undefined,
      result.ok ? undefined : result.stderr.slice(0, 500)
    )
    return result
  }

  // --- Install ---
  if (installRequired && !aborted(input.abortSignal)) {
    input.onProgress?.('Installing dependencies…')
    input.emitter.stepStart('install', 'Installing dependencies')
    try {
      const spec = await buildInstallCommand(input.sandbox.root)
      const result = await emitCommand(spec)
      installOk = result.ok
      if (!result.ok) {
        // Install failures use command_* events only — not ViteDiagnostic.source.
      }
    } catch (error) {
      installOk = false
      // Represented via command failure / gate — no ViteDiagnostic for install.
      void error
    }
  }

  if (installRequired && !installOk) {
    const gate = evaluateAgentRunGate({
      operation: 'mutation',
      writesOk,
      installRequired,
      installOk: false,
      buildOk: false,
      previewHealthOk: false,
    })
    return {
      gate,
      installRequired,
      installOk,
      buildOk,
      previewHealthOk,
      writesOk,
      diagnostics,
      repairAttempts,
      buildAttempts,
    }
  }

  // --- Build / repair loop ---
  while (buildAttempts < MAX_BUILD_ATTEMPTS && !aborted(input.abortSignal)) {
    buildAttempts += 1
    input.onProgress?.(
      buildAttempts === 1 ? 'Running build…' : `Rebuilding (attempt ${buildAttempts})…`
    )
    input.emitter.stepStart('build', 'Running build')
    const buildSpec = await buildBuildCommand(input.sandbox)
    const label = formatCommandLabel(buildSpec)
    input.emitter.emit({ type: 'build_start', data: { command: label } })
    input.emitter.toolStart('run_build')

    const buildResult = await runCommand(input.sandbox.root, buildSpec)

    if (buildResult.ok) {
      buildOk = true
      input.emitter.emit({
        type: 'build_success',
        data: { command: label, exitCode: 0 as const, durationMs: buildResult.durationMs },
      })
      input.emitter.toolResult('run_build', true)
      break
    }

    buildOk = false
    const diag =
      normalizeViteDiagnostic({
        stdout: buildResult.stdout,
        stderr: buildResult.stderr,
        source: 'build',
      }) ||
      normalizeViteDiagnostic({
        stdout: buildResult.stdout,
        stderr: buildResult.stderr,
        source: 'vite-transform',
      })

    input.emitter.emit({
      type: 'build_error',
      data: {
        command: label,
        exitCode: buildResult.exitCode,
        stdout: buildResult.stdout.slice(0, 8000),
        stderr: buildResult.stderr.slice(0, 8000),
        durationMs: buildResult.durationMs,
        diagnostic: diag || undefined,
      },
    })
    input.emitter.toolResult('run_build', false, diag?.file, diag?.message)

    if (diag) {
      diagnostics.push(diag)
      input.emitter.emit({ type: 'diagnostic', data: diag })
    }

    if (repairAttempts >= MAX_REPAIR_ATTEMPTS) {
      break
    }

    // Same-AgentRuntime repair
    repairAttempts += 1
    input.onProgress?.(`Repairing from diagnostic (attempt ${repairAttempts})…`)
    input.emitter.stepStart('repair', 'Repairing from build diagnostic')

    const repair = await performRepair({
      diagnostic: diag,
      fileMap: input.fileMap,
      attempt: repairAttempts,
      sandbox: input.sandbox,
      repairWithRuntime: input.repairWithRuntime,
      repairFn: input.repairFn,
      runCommand,
      emitCommand,
    })

    if (repair.action === 'none') {
      break
    }

    if (repair.action === 'install_only') {
      continue
    }

    if (repair.action === 'runtime_persisted') {
      // SAME AgentRuntime tools already persisted — do not double-write.
      if (dependenciesChanged(repair.writes.map((w) => w.path))) {
        installRequired = true
        try {
          const spec = await buildInstallCommand(input.sandbox.root)
          const result = await emitCommand(spec)
          installOk = result.ok
          if (!installOk) break
        } catch {
          installOk = false
          break
        }
      }
      continue
    }

    const accepted = await acceptRuntimeWrites({
      writes: repair.writes,
      fileMap: input.fileMap,
      persistMutation: input.persistMutation,
      source: 'guaranteed',
    })

    if (accepted.length === 0) {
      break
    }

    if (dependenciesChanged(accepted.map((w) => w.path))) {
      installRequired = true
      try {
        const spec = await buildInstallCommand(input.sandbox.root)
        const result = await emitCommand(spec)
        installOk = result.ok
        if (!installOk) break
      } catch {
        installOk = false
        break
      }
    }
  }

  // --- Preview health ---
  if (buildOk && !aborted(input.abortSignal)) {
    input.onProgress?.('Checking preview health…')
    input.emitter.stepStart('preview', 'Checking preview health')
    const check = input.checkPreview || ((url?: string) => checkPreviewHealth({ previewUrl: url }))
    const health = await check(input.previewUrl)
    previewHealthOk = health.ok
    input.emitter.emit({
      type: 'preview_status',
      data: {
        ok: health.ok,
        url: health.url,
        reason: health.reason,
      },
    })
    if (!health.ok) {
      const diag = normalizeViteDiagnostic({
        message: health.reason || 'Preview health failed',
        source: 'preview-smoke',
      })
      if (diag) {
        diagnostics.push(diag)
        input.emitter.emit({ type: 'diagnostic', data: diag })
      }
    }
  }

  const gate = evaluateAgentRunGate({
    operation: 'mutation',
    writesOk,
    installRequired,
    installOk,
    buildOk,
    previewHealthOk,
  })

  return {
    gate,
    installRequired,
    installOk,
    buildOk,
    previewHealthOk,
    writesOk,
    diagnostics,
    repairAttempts,
    buildAttempts,
  }
}

async function performRepair(input: {
  diagnostic: ViteDiagnostic | null
  fileMap: Record<string, { content?: string }>
  attempt: number
  sandbox: SandboxFilesystem
  repairWithRuntime?: Phase3RuntimeRepairFn
  repairFn?: Phase3RepairFn
  runCommand: Phase3CommandRunner
  emitCommand: (spec: AllowlistedCommandSpec, packages?: string[]) => Promise<SandboxCommandResult>
}): Promise<
  | { action: 'none' }
  | { action: 'install_only' }
  | { action: 'runtime_persisted'; writes: AgentWrite[] }
  | { action: 'writes'; writes: AgentWrite[] }
> {
  if (!input.diagnostic) return { action: 'none' }

  // Primary: SAME AgentRuntime continuation (streamText + tools + same planId)
  if (input.repairWithRuntime) {
    const result = await input.repairWithRuntime({
      diagnostic: input.diagnostic,
      fileMap: input.fileMap,
      attempt: input.attempt,
    })
    if (result.alreadyPersisted) {
      // Tools already persisted (or ran install); continue rebuild even if write list empty.
      return { action: 'runtime_persisted', writes: result.writes }
    }
    return result.writes.length > 0
      ? { action: 'writes', writes: result.writes }
      : { action: 'none' }
  }

  // Narrow test inject
  if (input.repairFn) {
    const writes = await input.repairFn({
      diagnostic: input.diagnostic,
      fileMap: input.fileMap,
      attempt: input.attempt,
    })
    return writes.length > 0 ? { action: 'writes', writes } : { action: 'none' }
  }

  // Heuristic fallback only (not primary architecture)
  const missing = extractMissingPackage(input.diagnostic)
  if (missing) {
    try {
      const spec = await buildInstallCommand(input.sandbox.root, [missing])
      const result = await input.emitCommand(spec, [missing])
      return result.ok ? { action: 'install_only' } : { action: 'none' }
    } catch {
      return { action: 'none' }
    }
  }

  if (
    input.diagnostic.file &&
    /Failed to resolve import|Cannot resolve module/i.test(input.diagnostic.message)
  ) {
    const filePath = input.diagnostic.file.replace(/^\.\//, '')
    const content = input.fileMap[filePath]?.content ?? (await input.sandbox.readFile(filePath))
    if (content) {
      const pkg = input.diagnostic.message.match(/["']([^"']+)["']/)?.[1]
      if (pkg && !pkg.startsWith('.')) {
        const next = content
          .split('\n')
          .filter((line) => !(line.includes(pkg) && /^\s*import\b/.test(line)))
          .join('\n')
        if (next !== content) {
          return {
            action: 'writes',
            writes: [
              {
                path: filePath,
                content: next,
                description: `Remove unresolved import ${pkg}`,
              },
            ],
          }
        }
      }
    }
  }

  return { action: 'none' }
}
