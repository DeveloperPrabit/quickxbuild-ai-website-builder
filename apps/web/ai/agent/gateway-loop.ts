/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * gateway-loop.ts — Agent Runtime generation routed through the ModelGateway
 *
 * Enabled only by QUICKXBUILD_MODEL_SERVICE_ENABLED. Same mutation lock, same tools,
 * same Phase 3 build/repair/preview and same acceptance gate as the provider path.
 * If the model service cannot answer the first turn, the caller falls back to the
 * existing provider path (nothing has been mutated at that point).
 */

import { createModelGatewayClient, type ModelGatewayClient } from '../model-gateway/client'
import { getModelServiceConfig, isTeacherEnabled } from '../model-gateway/config'
import type {
  InferenceRequest,
  RuntimeState,
  ToolName,
  ToolResultSummary,
} from '../model-gateway/contracts'
import { isEnvFile } from '../model-gateway/sanitize'
import type { TrajectoryRecorder } from '../model-gateway/trajectory-recorder'
import { type CompletedRun, type CompleteRunInput, completeAgentRun } from './complete-run'
import { runGatewayPass } from './gateway-pass'
import { pickRelevantFiles } from './relevant'
import type { RuntimeEmitter } from './runtime-emitter'
import type { PersistMutationFn } from './tools'
import type { AgentWrite } from './xml'

const MAX_CONTEXT_FILES = 30
const MAX_FILE_CHARS = 100_000
const ENTRY_FILES = ['src/App.tsx', 'src/pages/Index.tsx', 'src/main.tsx', 'package.json']

export type GatewayBodyInput = CompleteRunInput & {
  prompt: string
  userPlan: string
  knowledge?: string | null
  messageHistory?: string | null
}

export type GatewayBodyOutcome =
  | { kind: 'completed'; result: CompletedRun }
  | { kind: 'fallback'; reason: string }

function relevantFiles(fileMap: Record<string, { content?: string }>, prompt: string) {
  const paths = [...new Set([...pickRelevantFiles(fileMap, prompt, 20), ...ENTRY_FILES])]
  return paths
    .filter((path) => typeof fileMap[path]?.content === 'string' && !isEnvFile(path))
    .slice(0, MAX_CONTEXT_FILES)
    .map((path) => {
      const content = fileMap[path]?.content || ''
      const truncated = content.length > MAX_FILE_CHARS
      return { path, content: truncated ? content.slice(0, MAX_FILE_CHARS) : content, truncated }
    })
}

export function createDefaultGatewayClient(): ModelGatewayClient | null {
  const config = getModelServiceConfig()
  return config ? createModelGatewayClient(config) : null
}

export async function runGatewayAgentBody(ctx: {
  input: GatewayBodyInput
  client: ModelGatewayClient
  emitter: RuntimeEmitter
  persistMutation?: PersistMutationFn
  fileMap: Record<string, { content?: string }>
  mustApply: boolean
  recorder?: TrajectoryRecorder
}): Promise<GatewayBodyOutcome> {
  const { input, client, emitter, fileMap, mustApply, recorder } = ctx
  const planId = input.planId || 'pending'
  const availableTools: ToolName[] = input.sandbox
    ? ['write_file', 'apply_patch', 'install_packages', 'run_build', 'execute_command']
    : ['write_file', 'apply_patch']
  const toolHistory: ToolResultSummary[] = []
  let teacherCalls = 0
  let requestSeq = 0

  const buildRequest = (
    state: Partial<RuntimeState>,
    diagnostics: InferenceRequest['diagnostics']
  ) => ({
    request_id: `${planId}-${requestSeq++}`,
    project_id: input.projectId || 'unknown',
    task_id: planId,
    ...(recorder ? { trajectory_id: recorder.trajectoryId } : {}),
    prompt: input.prompt,
    ...(input.knowledge ? { project_context: input.knowledge.slice(0, 50_000) } : {}),
    relevant_files: relevantFiles(fileMap, input.prompt),
    diagnostics,
    previous_tool_results: toolHistory.slice(-100),
    available_tools: availableTools,
    runtime_state: {
      phase: 'initial' as const,
      repair_attempt: 0,
      build_failures: 0,
      preview_failures: 0,
      failed_tool_calls: toolHistory.filter((r) => !r.ok).length,
      teacher_calls_so_far: teacherCalls,
      ...state,
    },
    allow_teacher: isTeacherEnabled(),
  })

  const pass = async (request: InferenceRequest) => {
    const result = await runGatewayPass({
      client,
      request,
      fileMap,
      emitter,
      persistMutation: ctx.persistMutation,
      sandboxRoot: input.sandbox?.root,
      phase3RunCommand: input.phase3RunCommand,
      userPlan: input.userPlan,
      abortSignal: input.abortSignal,
      recorder,
      onProgress: input.onProgress,
      onTimeline: input.onTimeline,
    })
    toolHistory.push(...result.toolResults)
    if (result.response.teacher_used) teacherCalls += 1
    return result
  }

  input.onProgress?.('QuickXBuild model is planning changes…')
  let first: Awaited<ReturnType<typeof pass>>
  try {
    first = await pass(buildRequest({}, []))
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.warn(`[model-gateway] falling back to provider path: ${reason}`)
    return { kind: 'fallback', reason }
  }

  recorder?.setModel({
    source: 'model_service',
    provider: first.response.provider,
    model: first.response.model,
    model_version: first.response.model_version,
  })
  input.onTimeline?.({
    id: 'thought-plan',
    kind: 'thought',
    title: first.response.content.slice(0, 90) || 'Planned changes',
    detail: `QuickXBuild model ${first.response.model_version} (confidence ${first.response.confidence.toFixed(2)})`,
    status: 'done',
  })

  const allWrites: AgentWrite[] = [...first.writes]
  const result = await completeAgentRun({
    input,
    emitter,
    persistMutation: ctx.persistMutation,
    fileMap,
    allWrites,
    lastText: first.response.content,
    mustApply,
    repairWithRuntime: async ({ diagnostic, attempt }) => {
      try {
        const repair = await pass(
          buildRequest({ phase: 'repair', repair_attempt: attempt, build_failures: attempt }, [
            diagnostic,
          ])
        )
        const changed = repair.writes.length > 0 || repair.installRan
        return { writes: repair.writes, alreadyPersisted: changed }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        input.onProgress?.(`Model repair unavailable: ${reason}`)
        return { writes: [], alreadyPersisted: false }
      }
    },
  })
  return { kind: 'completed', result }
}
