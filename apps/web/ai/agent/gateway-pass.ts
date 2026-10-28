/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * gateway-pass.ts — One QuickXBuild model turn via the ModelGateway.
 *
 * The model service only PROPOSES actions. Each proposal is executed here through the
 * existing Agent Runtime tools (createAgentTools → persistMutation → sandbox), so path
 * validation, durable history, the mutation lock and runtime events stay authoritative.
 * Builds are deferred to Phase 3 — the runtime owns build/repair/preview.
 */

import type { ModelGatewayClient } from '../model-gateway/client'
import type {
  ActionProposal,
  InferenceRequest,
  InferenceResponse,
  ToolResultSummary,
} from '../model-gateway/contracts'
import type { TrajectoryRecorder } from '../model-gateway/trajectory-recorder'
import type { TimelineStep } from './complete-run'
import type { Phase3CommandRunner } from './phase3-pipeline'
import type { RuntimeEmitter } from './runtime-emitter'
import { executeAllowlistedCommand } from './sandbox-commands'
import { createAgentTools, type PersistMutationFn } from './tools'
import type { AgentWrite } from './xml'

type ToolExecute = (
  input: unknown,
  options: { toolCallId: string; messages: [] }
) => Promise<unknown>

export type GatewayPassResult = {
  response: InferenceResponse
  writes: AgentWrite[]
  toolResults: ToolResultSummary[]
  installRan: boolean
}

let toolCallSeq = 0

function resultOk(output: unknown): { ok: boolean; detail?: string } {
  if (output && typeof output === 'object' && 'ok' in output) {
    const record = output as { ok: unknown; error?: unknown; stderr?: unknown }
    const ok = record.ok === true
    const detail = ok
      ? undefined
      : String(record.error ?? record.stderr ?? 'tool failed').slice(0, 500)
    return { ok, detail }
  }
  return { ok: typeof output === 'string' && !/^(Failed|Error)/.test(output) }
}

export async function runGatewayPass(input: {
  client: ModelGatewayClient
  request: InferenceRequest
  fileMap: Record<string, { content?: string }>
  emitter: RuntimeEmitter
  persistMutation?: PersistMutationFn
  sandboxRoot?: string
  phase3RunCommand?: Phase3CommandRunner
  userPlan: string
  abortSignal?: AbortSignal
  recorder?: TrajectoryRecorder
  onProgress?: (message: string) => void
  onTimeline?: (step: TimelineStep) => void
}): Promise<GatewayPassResult> {
  const { emitter } = input
  const response = await input.client.infer(input.request, {
    abortSignal: input.abortSignal,
    onEvent: (event) => {
      if (event.event === 'model.teacher_escalation') {
        emitter.stepStart('teacher', 'Consulting the teacher model')
        input.onProgress?.('QuickXBuild model asked the teacher model for guidance…')
        input.onTimeline?.({
          id: `teacher-${input.request.request_id}`,
          kind: 'thought',
          title: 'Asking the teacher model for guidance',
          detail: event.text ? `Reason: ${event.text.replace(/_/g, ' ')}` : undefined,
          status: 'running',
        })
      }
    },
  })
  input.recorder?.recordModelDecision(response)
  if (response.teacher_used) {
    input.onTimeline?.({
      id: `teacher-${input.request.request_id}`,
      kind: 'thought',
      title: 'Teacher guidance received',
      detail: response.teacher?.guidance_summary,
      status: 'done',
    })
  }

  const runSandboxCommand = input.sandboxRoot
    ? (spec: import('./sandbox-commands').AllowlistedCommandSpec) =>
        (input.phase3RunCommand || executeAllowlistedCommand)(input.sandboxRoot as string, spec)
    : undefined
  const { tools } = createAgentTools(input.fileMap, {
    userPlan: input.userPlan,
    abortSignal: input.abortSignal,
    persistMutation: input.persistMutation,
    emitter,
    onProgress: input.onProgress,
    onTimeline: input.onTimeline,
    runSandboxCommand,
  })
  const toolMap = tools as unknown as Record<string, { execute?: ToolExecute }>

  const writes: AgentWrite[] = []
  const toolResults: ToolResultSummary[] = []
  let installRan = false
  input.recorder?.setActionSource(response.teacher_used ? 'teacher' : 'model')

  const execute = async (name: string, args: unknown, path?: string) => {
    const fn = toolMap[name]?.execute
    if (!fn) {
      const summary = { tool: name, ok: false, path, detail: 'tool not available in this runtime' }
      emitter.toolStart(name, path)
      emitter.toolResult(name, false, path, summary.detail)
      toolResults.push(summary)
      return summary
    }
    emitter.toolStart(name, path)
    const output = await fn(args, { toolCallId: `gw-${++toolCallSeq}`, messages: [] })
    const { ok, detail } = resultOk(output)
    emitter.toolResult(name, ok, path, detail)
    const summary = { tool: name, ok, path, detail }
    toolResults.push(summary)
    return summary
  }

  try {
    for (const action of response.actions as ActionProposal[]) {
      if (input.abortSignal?.aborted) break
      switch (action.tool) {
        case 'write_file':
        case 'apply_patch': {
          const result = await execute(
            action.tool,
            { path: action.path, content: action.content, description: action.description },
            action.path
          )
          if (result.ok) {
            writes.push({
              path: action.path,
              content: action.content,
              description: action.description,
            })
          }
          break
        }
        case 'install_packages': {
          const result = await execute('install_packages', { packages: action.packages })
          installRan = installRan || result.ok
          break
        }
        case 'execute_command': {
          if (action.kind === 'build' || action.kind === 'verify_dev') break
          await execute('execute_command', { kind: action.kind, why: action.why ?? undefined })
          break
        }
        case 'run_build':
          // Phase 3 runs the authoritative build after all writes.
          break
      }
    }
  } finally {
    input.recorder?.setActionSource(null)
  }

  return { response, writes, toolResults, installRan }
}
