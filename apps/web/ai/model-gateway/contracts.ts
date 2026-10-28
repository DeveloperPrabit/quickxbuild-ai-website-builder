/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * contracts.ts — Wire contract with services/model-server (mirrors app/schemas/*.py)
 *
 * Model output is validated here BEFORE any proposal reaches Agent Runtime tools.
 */

import { z } from 'zod/v4'
import type { ViteDiagnostic } from '../agent/runtime-events'

const BLOCKED_PATH = /(^|\/)(\.env(\..*)?|\.git|node_modules)(\/|$)/i

/** Relative project path. sandbox-fs re-validates before every write. */
export const ProjectPath = z
  .string()
  .min(1)
  .max(300)
  .refine((p) => !p.startsWith('/') && !/^[A-Za-z]:/.test(p), 'path must be relative')
  .refine((p) => !p.replace(/\\/g, '/').split('/').includes('..'), "path must not contain '..'")
  .refine((p) => !BLOCKED_PATH.test(p.replace(/\\/g, '/')), 'path targets a protected location')

const FileAction = {
  path: ProjectPath,
  content: z.string().max(400_000),
  description: z.string().min(1).max(500),
}

export const ActionProposal = z.discriminatedUnion('tool', [
  z.strictObject({ tool: z.literal('write_file'), ...FileAction }),
  z.strictObject({ tool: z.literal('apply_patch'), ...FileAction }),
  z.strictObject({
    tool: z.literal('install_packages'),
    packages: z
      .array(z.string().regex(/^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(@[\w.^~<>=*|-]+)?$/))
      .max(20),
  }),
  z.strictObject({ tool: z.literal('run_build') }),
  z.strictObject({
    tool: z.literal('execute_command'),
    kind: z.enum(['install', 'build', 'typecheck', 'test', 'verify_dev']),
    why: z.string().max(300).nullish(),
  }),
])
export type ActionProposal = z.infer<typeof ActionProposal>

export const EscalationReason = z.enum([
  'low_confidence',
  'no_valid_action',
  'repeated_tool_failure',
  'repeated_build_failure',
  'repeated_preview_failure',
  'unknown_framework',
  'unfamiliar_package',
  'unrepairable_diagnostic',
  'complexity_exceeded',
  'explicit_request',
])
export type EscalationReason = z.infer<typeof EscalationReason>

export const Usage = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  estimated_cost_usd: z.number().nonnegative(),
})

export const TeacherInterventionSummary = z.object({
  teacher_provider: z.string(),
  teacher_model: z.string(),
  reason: EscalationReason,
  guidance_summary: z.string(),
  guidance_steps: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  usage: Usage,
  latency_ms: z.number().int().nonnegative(),
})
export type TeacherInterventionSummary = z.infer<typeof TeacherInterventionSummary>

export const InferenceResponse = z.object({
  type: z.literal('model_response'),
  request_id: z.string(),
  provider: z.string(),
  model: z.string(),
  model_version: z.string(),
  content: z.string(),
  confidence: z.number().min(0).max(1),
  needs_teacher: z.boolean(),
  escalation_reason: EscalationReason.nullable(),
  actions: z.array(ActionProposal).max(40),
  teacher_used: z.boolean(),
  teacher: TeacherInterventionSummary.nullable(),
  usage: Usage,
  latency_ms: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
})
export type InferenceResponse = z.infer<typeof InferenceResponse>

export const ModelStreamEvent = z.object({
  event: z.enum([
    'model.status',
    'model.delta',
    'model.teacher_escalation',
    'model.final',
    'model.failed',
  ]),
  version: z.literal(1),
  request_id: z.string(),
  stage: z.enum(['model', 'teacher', 'model_with_guidance', 'done']).optional(),
  text: z.string().optional(),
  response: z.unknown().optional(),
  error_code: z.string().optional(),
  error_message: z.string().optional(),
})
export type ModelStreamEvent = z.infer<typeof ModelStreamEvent>

export type ToolName =
  | 'write_file'
  | 'apply_patch'
  | 'install_packages'
  | 'run_build'
  | 'execute_command'

export type ToolResultSummary = {
  tool: string
  ok: boolean
  path?: string
  detail?: string
}

export type RuntimeState = {
  phase: 'initial' | 'repair' | 'continue'
  repair_attempt: number
  build_failures: number
  preview_failures: number
  failed_tool_calls: number
  teacher_calls_so_far: number
}

export type InferenceRequest = {
  request_id: string
  project_id: string
  task_id: string
  trajectory_id?: string
  prompt: string
  conversation?: Array<{ role: 'user' | 'assistant'; content: string }>
  project_context?: string
  relevant_files: Array<{ path: string; content: string; truncated?: boolean }>
  diagnostics: ViteDiagnostic[]
  previous_tool_results: ToolResultSummary[]
  available_tools: ToolName[]
  runtime_state: RuntimeState
  allow_teacher: boolean
}

/** Trajectory step types: runtime event vocabulary + learning-specific types. */
export type TrajectoryStepType =
  | import('../agent/runtime-events').AgentEventType
  | 'model_decision'
  | 'teacher_intervention'
  | 'repair_attempt'

export type TrajectoryStep = {
  type: Exclude<TrajectoryStepType, 'progress' | 'timeline' | 'build_plan'>
  timestamp: string
  tool?: string
  data: Record<string, unknown>
}

export type TrajectoryGate = {
  success: boolean
  operation: 'mutation' | 'read_only'
  writes_ok: boolean
  install_required: boolean
  install_ok: boolean
  build_ok: boolean
  preview_health_ok: boolean
  failures: string[]
}

export type TrajectoryPayload = {
  trajectory_id: string
  project_id: string
  task_id: string
  plan_id?: string
  original_prompt: string
  initial_state: {
    file_count: number
    files: string[]
    relevant_files: Array<{ path: string; content: string; truncated: boolean }>
  }
  model: {
    source: 'model_service' | 'legacy_provider'
    provider: string
    model: string
    model_version?: string
  }
  teacher_used: boolean
  teacher_calls: number
  steps: TrajectoryStep[]
  final_state: {
    applied: boolean
    files_changed: Array<{ path: string; content: string; truncated: boolean }>
    gate?: TrajectoryGate
    error?: string
  }
  training_eligible: false
}
