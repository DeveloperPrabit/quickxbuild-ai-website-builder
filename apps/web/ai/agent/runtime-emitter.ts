/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * runtime-emitter.ts — Validate + emit Agent Runtime NDJSON events (Phase 1)
 */

import {
  AGENT_EVENT_VERSION,
  createSandboxFilePatchEvent,
  createSandboxFileWriteEvent,
  parseAgentEvent,
  type AgentEvent,
} from './runtime-events'

export type AgentEventSink = (event: AgentEvent) => void

export type RuntimeEmitter = {
  planId: string
  emit: (raw: Record<string, unknown>) => void
  agentStart: (operation?: 'mutation' | 'read_only') => void
  stepStart: (step: string, title?: string) => void
  toolStart: (tool: string, path?: string) => void
  toolResult: (tool: string, ok: boolean, path?: string, detail?: string) => void
  /** Emit only after sandbox write + durable history succeeded. */
  fileWrite: (path: string, bytes?: number, description?: string) => void
  /** Emit only after sandbox patch + durable history succeeded. */
  filePatch: (path: string, bytes?: number, description?: string) => void
  agentDone: (success: boolean) => void
  agentError: (message: string) => void
}

/**
 * Create a typed event emitter bound to one planId.
 * Invalid payloads are dropped (never forwarded as canonical events).
 */
export function createRuntimeEmitter(
  planId: string,
  sink: AgentEventSink | undefined
): RuntimeEmitter {
  const emit: RuntimeEmitter['emit'] = (raw) => {
    if (!sink) return
    const withVersion = {
      ...raw,
      version: AGENT_EVENT_VERSION,
      planId,
      ts: typeof raw.ts === 'number' ? raw.ts : Date.now(),
    }
    const parsed = parseAgentEvent(withVersion)
    if (!parsed) {
      console.warn('[AgentRuntime] dropped invalid event', raw.type)
      return
    }
    sink(parsed)
  }

  return {
    planId,
    emit,
    agentStart: (operation) => {
      emit(
        operation
          ? { type: 'agent_start', data: { operation } }
          : { type: 'agent_start' }
      )
    },
    stepStart: (step, title) => {
      emit({ type: 'step_start', data: { step, title } })
    },
    toolStart: (tool, path) => {
      emit({ type: 'tool_start', data: { tool, path } })
    },
    toolResult: (tool, ok, path, detail) => {
      emit({ type: 'tool_result', data: { tool, ok, path, detail } })
    },
    fileWrite: (path, bytes, description) => {
      if (!sink) return
      sink(
        createSandboxFileWriteEvent({
          planId,
          path,
          bytes,
          description,
        })
      )
    },
    filePatch: (path, bytes, description) => {
      if (!sink) return
      sink(
        createSandboxFilePatchEvent({
          planId,
          path,
          bytes,
          description,
        })
      )
    },
    agentDone: (success) => {
      emit({ type: 'agent_done', data: { success } })
    },
    agentError: (message) => {
      emit({ type: 'agent_error', data: { message } })
    },
  }
}
