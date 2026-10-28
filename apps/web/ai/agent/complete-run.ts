/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * complete-run.ts — Shared tail of every Agent Runtime generation:
 *   summary → Phase 3 (install → build → repair → preview) → gate → terminal events.
 *
 * Both the provider path and the ModelGateway path finish here, so the acceptance gate,
 * repair limits and terminal NDJSON events have exactly one implementation.
 */

import { stringToTextStream } from './apply'
import {
  type Phase3CommandRunner,
  type Phase3RuntimeRepairFn,
  runPhase3InstallBuildRepair,
} from './phase3-pipeline'
import type { PreviewHealthResult } from './preview-health'
import type { RuntimeEmitter } from './runtime-emitter'
import type { AgentRunGateResult } from './runtime-gate'
import type { SandboxFilesystem } from './sandbox-fs'
import { buildWarmSummary } from './tasks'
import type { PersistMutationFn } from './tools'
import { type AgentWrite, synthesizePlanXml } from './xml'

export type TimelineStep = {
  kind: 'thought' | 'check' | 'edit' | 'verify' | 'summary'
  title: string
  detail?: string
  path?: string
  durationMs?: number
  status?: 'running' | 'done' | 'failed'
  id?: string
}

export type CompleteRunInput = {
  planId?: string
  projectId?: string
  sandbox?: SandboxFilesystem
  abortSignal?: AbortSignal
  phase3RunCommand?: Phase3CommandRunner
  phase3CheckPreview?: (url?: string) => Promise<PreviewHealthResult>
  phase3PreviewUrl?: string
  onProgress?: (message: string) => void
  onTimeline?: (step: TimelineStep) => void
}

export type CompletedRun = {
  textStream: ReadableStream<string>
  applied: boolean
  writes: AgentWrite[]
  phase3Gate?: AgentRunGateResult
}

export function dedupeWrites(writes: AgentWrite[]): AgentWrite[] {
  const seen = new Set<string>()
  const next: AgentWrite[] = []
  for (const write of writes) {
    const key = `${write.path}:${write.content.length}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    next.push(write)
  }
  return next
}

export async function completeAgentRun(ctx: {
  input: CompleteRunInput
  emitter: RuntimeEmitter
  persistMutation?: PersistMutationFn
  fileMap: Record<string, { content?: string }>
  allWrites: AgentWrite[]
  lastText: string
  mustApply: boolean
  repairWithRuntime: Phase3RuntimeRepairFn
}): Promise<CompletedRun> {
  const { input, emitter, persistMutation, fileMap, lastText, mustApply } = ctx
  const onProgress = input.onProgress
  const onTimeline = input.onTimeline

  const mergedWrites = dedupeWrites(ctx.allWrites)
  if (mergedWrites.length > 0) {
    const fileNames = mergedWrites
      .map((write) => write.path.split('/').pop() || write.path)
      .slice(0, 3)
      .join(', ')
    onProgress?.(
      `Finished writing ${mergedWrites.length} file${mergedWrites.length === 1 ? '' : 's'}`
    )
    onTimeline?.({
      kind: 'verify',
      title: 'Checking the app still builds',
      detail: `Applied ${mergedWrites.length} file update${mergedWrites.length === 1 ? '' : 's'}. Preview will refresh next.`,
      status: 'done',
    })
    onTimeline?.({
      kind: 'summary',
      title:
        mergedWrites.length === 1
          ? `Updated ${fileNames}`
          : `Updated ${mergedWrites.length} files${fileNames ? ` (${fileNames}${mergedWrites.length > 3 ? ', …' : ''})` : ''}`,
      detail: buildWarmSummary(mergedWrites.map((write) => write.path)),
      status: 'done',
    })
  }

  const applied = mergedWrites.length > 0
  let phase3Gate: AgentRunGateResult | undefined

  // Phase 3: install → build → diagnose → repair → rebuild → preview (same AgentRuntime)
  if (mustApply && applied && input.sandbox && persistMutation && !input.abortSignal?.aborted) {
    const phase3 = await runPhase3InstallBuildRepair({
      projectId: input.projectId || 'unknown',
      planId: input.planId || 'pending',
      sandbox: input.sandbox,
      emitter,
      persistMutation,
      fileMap,
      writtenPaths: mergedWrites.map((w) => w.path),
      abortSignal: input.abortSignal,
      runCommand: input.phase3RunCommand,
      checkPreview: input.phase3CheckPreview,
      previewUrl: input.phase3PreviewUrl,
      onProgress,
      repairWithRuntime: ctx.repairWithRuntime,
    })
    phase3Gate = phase3.gate
  }

  const output = applied
    ? synthesizePlanXml(
        lastText || 'Implementing the requested file changes.',
        'Applied file updates for the user request.',
        mergedWrites
      )
    : lastText

  // Terminal Agent Runtime event — success gate authoritative when Phase 3 ran
  if (input.abortSignal?.aborted) {
    emitter.agentError('Request aborted')
  } else if (phase3Gate) {
    if (phase3Gate.success) {
      emitter.emit({ type: 'apply_ok', data: { content: 'Phase 3 gate passed' } })
    } else {
      emitter.emit({
        type: 'apply_failed',
        data: { content: phase3Gate.failures.join(',') || 'phase3_gate_failed' },
      })
    }
    emitter.emit({
      type: 'agent_done',
      data: {
        success: phase3Gate.success,
        gate: {
          operation: phase3Gate.operation,
          writesOk: phase3Gate.writesOk,
          installOk: phase3Gate.installOk,
          buildOk: phase3Gate.buildOk,
          previewHealthOk: phase3Gate.previewHealthOk,
          installRequired: phase3Gate.installRequired,
        },
      },
    })
  } else {
    emitter.agentDone(applied || !mustApply)
  }

  return {
    textStream: stringToTextStream(output),
    applied,
    writes: mergedWrites,
    phase3Gate,
  }
}
