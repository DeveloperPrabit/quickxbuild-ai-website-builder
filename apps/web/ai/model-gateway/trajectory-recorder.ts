/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * trajectory-recorder.ts — Tee of Agent Runtime events into a development trajectory
 *
 * Observes the SAME NDJSON events the browser receives (no second protocol), plus
 * model decisions and teacher interventions. No chain-of-thought is recorded.
 */

import { randomUUID } from 'node:crypto'
import type { AgentEvent } from '../agent/runtime-events'
import type { AgentRunGateResult } from '../agent/runtime-gate'
import type { InferenceResponse, TrajectoryPayload, TrajectoryStep } from './contracts'
import { isEnvFile, redactSecrets } from './sanitize'

const MAX_STEPS = 2500
const MAX_TEXT = 4000
const MAX_FILE_CHARS = 200_000
const MAX_FILES = 200
const MAX_RELEVANT = 30
const LEGACY_EVENTS = new Set(['progress', 'timeline', 'build_plan'])

export type ActionSource = 'model' | 'teacher'

export type TrajectoryRecorder = {
  readonly trajectoryId: string
  observe(event: AgentEvent): void
  setModel(info: TrajectoryPayload['model']): void
  setActionSource(source: ActionSource | null): void
  recordModelDecision(response: InferenceResponse): void
  finalize(result: {
    applied: boolean
    writes: Array<{ path: string; content: string }>
    gate?: AgentRunGateResult
    error?: string
  }): TrajectoryPayload
}

function clip(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactSecrets(value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}…` : value)
  }
  if (Array.isArray(value)) return value.slice(0, 50).map(clip)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clip(v)]))
  }
  return value
}

function snapshot(path: string, content: string) {
  if (isEnvFile(path)) return { path, content: '[REDACTED_ENV_FILE]', truncated: false }
  const truncated = content.length > MAX_FILE_CHARS
  return {
    path,
    content: redactSecrets(truncated ? content.slice(0, MAX_FILE_CHARS) : content),
    truncated,
  }
}

export function createTrajectoryRecorder(init: {
  projectId: string
  taskId: string
  planId?: string
  prompt: string
  fileMap: Record<string, { content?: string }>
  relevantPaths?: string[]
  model: TrajectoryPayload['model']
}): TrajectoryRecorder {
  const trajectoryId = `trj_${randomUUID().replace(/-/g, '').slice(0, 24)}`
  const steps: TrajectoryStep[] = []
  let model = init.model
  let source: ActionSource | null = null
  let teacherCalls = 0
  const files = Object.keys(init.fileMap).sort()
  const relevant = (init.relevantPaths || [])
    .filter((p) => typeof init.fileMap[p]?.content === 'string')
    .slice(0, MAX_RELEVANT)
    .map((p) => snapshot(p, init.fileMap[p]?.content || ''))

  const push = (step: TrajectoryStep) => {
    if (steps.length < MAX_STEPS) steps.push(step)
  }
  const now = () => new Date().toISOString()

  return {
    trajectoryId,

    observe(event) {
      if (LEGACY_EVENTS.has(event.type)) return
      const data = (clip((event as { data?: unknown }).data ?? {}) || {}) as Record<string, unknown>
      const tool = typeof data.tool === 'string' ? data.tool : undefined
      if (event.type === 'tool_result' && source) data.source = source
      push({
        type: event.type as TrajectoryStep['type'],
        timestamp: event.ts ? new Date(event.ts).toISOString() : now(),
        ...(tool ? { tool } : {}),
        data,
      })
      if (event.type === 'step_start' && data.step === 'repair') {
        push({ type: 'repair_attempt', timestamp: now(), data: { title: data.title ?? 'repair' } })
      }
    },

    setModel(info) {
      model = info
    },

    setActionSource(next) {
      source = next
    },

    recordModelDecision(response) {
      push({
        type: 'model_decision',
        timestamp: now(),
        data: {
          content: redactSecrets(response.content.slice(0, MAX_TEXT)),
          confidence: response.confidence,
          needs_teacher: response.needs_teacher,
          escalation_reason: response.escalation_reason,
          proposed_actions: response.actions.map((a) =>
            'path' in a ? `${a.tool}:${a.path}` : a.tool
          ),
          model_version: response.model_version,
          warnings: response.warnings,
        },
      })
      if (response.teacher_used && response.teacher) {
        teacherCalls += 1
        push({
          type: 'teacher_intervention',
          timestamp: now(),
          data: {
            reason: response.teacher.reason,
            summary: redactSecrets(response.teacher.guidance_summary),
            steps: response.teacher.guidance_steps.map(redactSecrets),
            provider: response.teacher.teacher_provider,
            model: response.teacher.teacher_model,
            confidence: response.teacher.confidence,
          },
        })
      }
    },

    finalize(result) {
      const changed = new Map<string, string>()
      for (const write of result.writes) changed.set(write.path, write.content)
      const gate = result.gate
      return {
        trajectory_id: trajectoryId,
        project_id: init.projectId,
        task_id: init.taskId,
        ...(init.planId ? { plan_id: init.planId } : {}),
        original_prompt: redactSecrets(init.prompt),
        initial_state: {
          file_count: files.length,
          files: files.slice(0, 1000),
          relevant_files: relevant,
        },
        model,
        teacher_used: teacherCalls > 0,
        teacher_calls: teacherCalls,
        steps,
        final_state: {
          applied: result.applied,
          files_changed: [...changed.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .slice(0, MAX_FILES)
            .map(([path, content]) => snapshot(path, content)),
          ...(gate
            ? {
                gate: {
                  success: gate.success,
                  operation: gate.operation,
                  writes_ok: gate.writesOk,
                  install_required: gate.installRequired,
                  install_ok: gate.installOk,
                  build_ok: gate.buildOk,
                  preview_health_ok: gate.previewHealthOk,
                  failures: [...gate.failures],
                },
              }
            : {}),
          ...(result.error ? { error: redactSecrets(result.error).slice(0, 2000) } : {}),
        },
        training_eligible: false,
      }
    },
  }
}
