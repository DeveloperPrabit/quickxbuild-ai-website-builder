/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * use-agent-run-store.ts — Per-plan Agent Runtime run history (Details view)
 */

import { create } from 'zustand'

export type RunStepKind = 'thought' | 'read' | 'edit' | 'terminal' | 'check' | 'summary'
export type RunStepStatus = 'running' | 'done' | 'failed'

export type RunStep = {
  id: string
  kind: RunStepKind
  title: string
  path?: string
  detail?: string
  status: RunStepStatus
  startedAt: number
  durationMs?: number
}

export type RunChange = {
  path: string
  original: string | null
  modified: string
  isNew?: boolean
}

export type AgentRun = {
  planId: string
  startedAt: number
  endedAt?: number
  status: 'running' | 'done' | 'failed'
  latestLabel: string
  steps: RunStep[]
  changes: RunChange[]
}

export const MAX_RUNS = 20
const MAX_STEPS_PER_RUN = 300

type StepInput = Omit<RunStep, 'id' | 'startedAt' | 'status'> & {
  id?: string
  status?: RunStepStatus
  startedAt?: number
}

type AgentRunState = {
  runs: Record<string, AgentRun>
  order: string[]
  startRun: (planId: string) => void
  /** Insert or update a step. Same id updates in place (status/detail/duration). */
  pushStep: (planId: string, step: StepInput) => string
  upsertChange: (planId: string, change: RunChange) => void
  finishRun: (planId: string, status: 'done' | 'failed') => void
  reset: () => void
}

let stepSeq = 0

function fileName(path: string): string {
  return path.split('/').pop() || path
}

/** Present-progressive chat label for the newest step ("Editing App.tsx"). */
export function labelForStep(step: Pick<RunStep, 'kind' | 'title' | 'path' | 'status'>): string {
  if (step.kind === 'read' && step.path) {
    return step.status === 'running' ? `Reading ${fileName(step.path)}` : `Read ${fileName(step.path)}`
  }
  if (step.kind === 'edit' && step.path) {
    return step.status === 'running'
      ? `Editing ${fileName(step.path)}`
      : `Edited ${fileName(step.path)}`
  }
  if (step.kind === 'terminal') {
    return step.status === 'running' ? `Running ${step.title}` : `Ran ${step.title}`
  }
  return step.title
}

function emptyRun(planId: string): AgentRun {
  return {
    planId,
    startedAt: Date.now(),
    status: 'running',
    latestLabel: 'Starting…',
    steps: [],
    changes: [],
  }
}

function trimOrder(order: string[], runs: Record<string, AgentRun>) {
  if (order.length <= MAX_RUNS) {
    return { order, runs }
  }
  const drop = order.slice(0, order.length - MAX_RUNS)
  const nextRuns = { ...runs }
  for (const id of drop) {
    delete nextRuns[id]
  }
  return { order: order.slice(-MAX_RUNS), runs: nextRuns }
}

export const useAgentRunStore = create<AgentRunState>((set, get) => ({
  runs: {},
  order: [],
  startRun: (planId) => {
    set((state) => {
      const runs = { ...state.runs, [planId]: emptyRun(planId) }
      const order = [...state.order.filter((id) => id !== planId), planId]
      return trimOrder(order, runs)
    })
  },
  pushStep: (planId, input) => {
    const id = input.id || `step-${Date.now()}-${++stepSeq}`
    set((state) => {
      const base = state.runs[planId]
      let runs = state.runs
      let order = state.order
      if (!base) {
        runs = { ...runs, [planId]: emptyRun(planId) }
        order = [...order, planId]
      }
      const run = runs[planId] as AgentRun
      const now = Date.now()
      const existingIndex = run.steps.findIndex((step) => step.id === id)
      let steps: RunStep[]
      let step: RunStep
      if (existingIndex >= 0) {
        const prev = run.steps[existingIndex] as RunStep
        const status = input.status || prev.status
        step = {
          ...prev,
          ...input,
          id,
          status,
          startedAt: prev.startedAt,
          durationMs:
            input.durationMs ??
            (status !== 'running' && prev.status === 'running' ? now - prev.startedAt : prev.durationMs),
          detail: input.detail ?? prev.detail,
          path: input.path ?? prev.path,
        }
        steps = [...run.steps]
        steps[existingIndex] = step
      } else {
        step = {
          ...input,
          id,
          status: input.status || 'done',
          startedAt: input.startedAt || now,
        }
        steps = [...run.steps, step].slice(-MAX_STEPS_PER_RUN)
      }
      const nextRun: AgentRun = {
        ...run,
        steps,
        latestLabel: run.status === 'running' ? labelForStep(step) : run.latestLabel,
      }
      return trimOrder(order, { ...runs, [planId]: nextRun })
    })
    return id
  },
  upsertChange: (planId, change) => {
    set((state) => {
      const run = state.runs[planId] || emptyRun(planId)
      const index = run.changes.findIndex((item) => item.path === change.path)
      let changes: RunChange[]
      if (index >= 0) {
        const prev = run.changes[index] as RunChange
        changes = [...run.changes]
        changes[index] = {
          path: change.path,
          // Keep the first original so the diff shows the whole run's effect.
          original: prev.original,
          modified: change.modified,
          isNew: prev.isNew,
        }
      } else {
        changes = [...run.changes, change]
      }
      const order = state.runs[planId] ? state.order : [...state.order, planId]
      return trimOrder(order, { ...state.runs, [planId]: { ...run, changes } })
    })
  },
  finishRun: (planId, status) => {
    const run = get().runs[planId]
    if (!run || run.status !== 'running') {
      return
    }
    set((state) => {
      const current = state.runs[planId]
      if (!current) return state
      const endedAt = Date.now()
      const steps = current.steps.map((step) =>
        step.status === 'running'
          ? { ...step, status: status === 'failed' ? ('failed' as const) : ('done' as const), durationMs: endedAt - step.startedAt }
          : step
      )
      const edited = current.changes.length
      const seconds = Math.max(1, Math.round((endedAt - current.startedAt) / 1000))
      const latestLabel =
        status === 'failed'
          ? `Finished with errors · ${seconds}s`
          : edited > 0
            ? `Edited ${edited} file${edited === 1 ? '' : 's'} · ${seconds}s`
            : `Done · ${seconds}s`
      return {
        runs: { ...state.runs, [planId]: { ...current, steps, status, endedAt, latestLabel } },
      }
    })
  },
  reset: () => set({ runs: {}, order: [] }),
}))
