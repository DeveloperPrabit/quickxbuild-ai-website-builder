/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * use-agent-board-store.ts
 * Copyright (C) 2025 Nextify Limited
 */

import { create } from 'zustand'

export type AgentBoardTask = {
  id: string
  title: string
  agent: string
  status: string
  files: string[]
  reason?: string
}

export type BuildPlanItem = {
  id: string
  label: string
  status: 'pending' | 'running' | 'done' | 'failed'
}

export type BuildPlanState = {
  brandName?: string
  vertical?: string
  items: BuildPlanItem[]
}

export type PreviewReadyStatus = 'idle' | 'applying' | 'applied' | 'ready' | 'failed'

export type TimelineKind = 'thought' | 'check' | 'edit' | 'verify' | 'summary' | 'terminal'

export type TimelineStep = {
  id: string
  kind: TimelineKind
  title: string
  detail?: string
  path?: string
  durationMs?: number
  status?: 'running' | 'done' | 'failed'
}

type AgentBoardState = {
  planId: string | null
  tasks: AgentBoardTask[]
  buildPlan: BuildPlanState | null
  previewStatus: PreviewReadyStatus
  previewMessage: string
  activity: string[]
  summary: string
  timeline: TimelineStep[]
  setTasks: (planId: string, tasks: AgentBoardTask[]) => void
  setBuildPlan: (planId: string, plan: BuildPlanState) => void
  updateBuildPlanItem: (id: string, status: BuildPlanItem['status']) => void
  setPreviewStatus: (status: PreviewReadyStatus, message?: string) => void
  pushActivity: (message: string) => void
  pushTimeline: (step: Omit<TimelineStep, 'id'> & { id?: string }) => void
  setSummary: (message: string) => void
  reset: () => void
}

let timelineSeq = 0

export const useAgentBoardStore = create<AgentBoardState>((set) => ({
  planId: null,
  tasks: [],
  buildPlan: null,
  previewStatus: 'idle',
  previewMessage: '',
  activity: [],
  summary: '',
  timeline: [],
  setTasks: (planId, tasks) => {
    set({ planId, tasks })
  },
  setBuildPlan: (planId, plan) => {
    set({ planId, buildPlan: plan })
  },
  updateBuildPlanItem: (id, status) => {
    set((state) => {
      if (!state.buildPlan) {
        return state
      }
      return {
        buildPlan: {
          ...state.buildPlan,
          items: state.buildPlan.items.map((item) =>
            item.id === id ? { ...item, status } : item
          ),
        },
      }
    })
  },
  setPreviewStatus: (status, message) => {
    set({
      previewStatus: status,
      previewMessage: message || '',
    })
  },
  pushActivity: (message) => {
    const text = message.trim()
    if (!text) {
      return
    }
    set((state) => {
      if (state.activity[state.activity.length - 1] === text) {
        return state
      }
      return { activity: [...state.activity.slice(-11), text] }
    })
  },
  pushTimeline: (step) => {
    const id = step.id || `t-${Date.now()}-${++timelineSeq}`
    set((state) => {
      const next: TimelineStep = {
        id,
        kind: step.kind,
        title: step.title,
        detail: step.detail,
        path: step.path,
        durationMs: step.durationMs,
        status: step.status || 'done',
      }
      const existing = state.timeline.findIndex((item) => item.id === id)
      if (existing >= 0) {
        const copy = [...state.timeline]
        copy[existing] = { ...copy[existing], ...next }
        return { timeline: copy }
      }
      // Dedupe consecutive identical titles
      const last = state.timeline[state.timeline.length - 1]
      if (last && last.kind === next.kind && last.title === next.title && last.path === next.path) {
        return state
      }
      return { timeline: [...state.timeline.slice(-40), next] }
    })
  },
  setSummary: (message) => {
    set({ summary: message })
  },
  reset: () => {
    set({
      planId: null,
      tasks: [],
      buildPlan: null,
      previewStatus: 'idle',
      previewMessage: '',
      activity: [],
      summary: '',
      timeline: [],
    })
  },
}))
