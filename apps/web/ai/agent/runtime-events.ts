/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * runtime-events.ts — Frozen Agent Runtime NDJSON contract (Phase 0)
 *
 * Canonical lifecycle (no private chain-of-thought / model reasoning):
 *   agent_start → step_start → tool_* → file_write|file_patch →
 *   command_* → build_* → preview_status → diagnostic →
 *   apply_ok|apply_failed → agent_error|agent_done
 *
 * Legacy progress/timeline are compatibility-only for existing UI.
 * file_write / file_patch require persistedToSandbox: true (sandbox SoT).
 * Do not emit those events from in-memory-only tool writes (Phase 1 must not).
 */

import { z } from 'zod/v4'

/** Wire protocol version for Agent Runtime events. */
export const AGENT_EVENT_VERSION = 1 as const

/** Where a diagnostic originated. */
export type DiagnosticSource = z.infer<typeof DiagnosticSource>
/** Where a diagnostic originated — frozen Phase 3 contract (four values only). */
export const DiagnosticSource = z.enum(['vite-transform', 'vite-hmr', 'build', 'preview-smoke'])

/**
 * Normalized Vite/build/preview diagnostic.
 * Prefer the root module-resolution / transform message over internal Vite frames.
 */
export type ViteDiagnostic = z.infer<typeof ViteDiagnostic>
/** Normalized Vite/build/preview diagnostic. */
export const ViteDiagnostic = z.object({
  message: z.string(),
  file: z.string().optional(),
  line: z.number().optional(),
  column: z.number().optional(),
  stack: z.string().optional(),
  source: DiagnosticSource,
})

/** Canonical + legacy Agent Runtime event type names. */
export type AgentEventType = z.infer<typeof AgentEventType>
/** Canonical + legacy Agent Runtime event type names. */
export const AgentEventType = z.enum([
  'agent_start',
  'step_start',
  'tool_start',
  'tool_result',
  'file_write',
  'file_patch',
  'command_start',
  'command_output',
  'command_result',
  'build_start',
  'build_error',
  'build_success',
  'preview_status',
  'diagnostic',
  'apply_ok',
  'apply_failed',
  'agent_error',
  'agent_done',
  // Temporary UI compatibility — safe status only, never model CoT
  'progress',
  'timeline',
  'build_plan',
])

/** Shared envelope for every Agent Runtime NDJSON line. */
export type AgentEventBase = z.infer<typeof AgentEventBase>
/** Shared envelope for every Agent Runtime NDJSON line. */
export const AgentEventBase = z.object({
  type: AgentEventType,
  version: z.literal(AGENT_EVENT_VERSION),
  planId: z.string(),
  ts: z.number().optional(),
})

/** Generation started. Safe status only — no model reasoning. */
export type AgentStartEvent = z.infer<typeof AgentStartEvent>
/** Generation started. Safe status only — no model reasoning. */
export const AgentStartEvent = AgentEventBase.extend({
  type: z.literal('agent_start'),
  data: z
    .object({
      operation: z.enum(['mutation', 'read_only']).optional(),
    })
    .optional(),
})

/** High-level execution step started (plan/check/write/build/…). Not CoT. */
export type StepStartEvent = z.infer<typeof StepStartEvent>
/** High-level execution step started (plan/check/write/build/…). Not CoT. */
export const StepStartEvent = AgentEventBase.extend({
  type: z.literal('step_start'),
  data: z.object({
    step: z.string(),
    title: z.string().optional(),
  }),
})

/** Tool invocation started. */
export type ToolStartEvent = z.infer<typeof ToolStartEvent>
/** Tool invocation started. */
export const ToolStartEvent = AgentEventBase.extend({
  type: z.literal('tool_start'),
  data: z.object({
    tool: z.string(),
    path: z.string().optional(),
    argsSummary: z.string().optional(),
  }),
})

/** Tool invocation finished. */
export type ToolResultEvent = z.infer<typeof ToolResultEvent>
/** Tool invocation finished. */
export const ToolResultEvent = AgentEventBase.extend({
  type: z.literal('tool_result'),
  data: z.object({
    tool: z.string(),
    ok: z.boolean(),
    path: z.string().optional(),
    detail: z.string().optional(),
  }),
})

/**
 * Authoritative full-file write AFTER sandbox write succeeded.
 * persistedToSandbox must be true. Never emit from in-memory-only tools.
 */
export type FileWriteEvent = z.infer<typeof FileWriteEvent>
/** Authoritative full-file write AFTER sandbox write succeeded. */
export const FileWriteEvent = AgentEventBase.extend({
  type: z.literal('file_write'),
  data: z.object({
    path: z.string(),
    bytes: z.number().optional(),
    description: z.string().optional(),
    persistedToSandbox: z.literal(true),
  }),
})

/**
 * Authoritative patch/apply AFTER sandbox write succeeded.
 * persistedToSandbox must be true. Never emit from in-memory-only tools.
 */
export type FilePatchEvent = z.infer<typeof FilePatchEvent>
/** Authoritative patch/apply AFTER sandbox write succeeded. */
export const FilePatchEvent = AgentEventBase.extend({
  type: z.literal('file_patch'),
  data: z.object({
    path: z.string(),
    bytes: z.number().optional(),
    description: z.string().optional(),
    persistedToSandbox: z.literal(true),
  }),
})

/** Allowlisted command / install started. */
export type CommandStartEvent = z.infer<typeof CommandStartEvent>
/** Allowlisted command / install started. */
export const CommandStartEvent = AgentEventBase.extend({
  type: z.literal('command_start'),
  data: z.object({
    command: z.string(),
    packages: z.array(z.string()).optional(),
    why: z.string().optional(),
  }),
})

/** Streaming / chunked command stdout/stderr (safe execution output). */
export type CommandOutputEvent = z.infer<typeof CommandOutputEvent>
/** Streaming / chunked command stdout/stderr (safe execution output). */
export const CommandOutputEvent = AgentEventBase.extend({
  type: z.literal('command_output'),
  data: z.object({
    command: z.string(),
    stream: z.enum(['stdout', 'stderr']),
    chunk: z.string(),
  }),
})

/** Allowlisted command / install finished. */
export type CommandResultEvent = z.infer<typeof CommandResultEvent>
/** Allowlisted command / install finished. */
export const CommandResultEvent = AgentEventBase.extend({
  type: z.literal('command_result'),
  data: z.object({
    command: z.string(),
    exitCode: z.number(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    durationMs: z.number().optional(),
  }),
})

/** Build started inside AgentRuntime. */
export type BuildStartEvent = z.infer<typeof BuildStartEvent>
/** Build started inside AgentRuntime. */
export const BuildStartEvent = AgentEventBase.extend({
  type: z.literal('build_start'),
  data: z.object({
    command: z.string(),
  }),
})

/** Build failed inside AgentRuntime. */
export type BuildErrorEvent = z.infer<typeof BuildErrorEvent>
/** Build failed inside AgentRuntime. */
export const BuildErrorEvent = AgentEventBase.extend({
  type: z.literal('build_error'),
  data: z.object({
    command: z.string(),
    exitCode: z.number(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    durationMs: z.number().optional(),
    diagnostic: ViteDiagnostic.optional(),
  }),
})

/** Build succeeded inside AgentRuntime. */
export type BuildSuccessEvent = z.infer<typeof BuildSuccessEvent>
/** Build succeeded inside AgentRuntime. */
export const BuildSuccessEvent = AgentEventBase.extend({
  type: z.literal('build_success'),
  data: z.object({
    command: z.string(),
    exitCode: z.literal(0).optional(),
    durationMs: z.number().optional(),
  }),
})

/** Preview health / sync status. */
export type PreviewStatusEvent = z.infer<typeof PreviewStatusEvent>
/** Preview health / sync status. */
export const PreviewStatusEvent = AgentEventBase.extend({
  type: z.literal('preview_status'),
  data: z.object({
    ok: z.boolean(),
    url: z.string().optional(),
    reason: z.string().optional(),
  }),
})

/** Normalized diagnostic for the same AgentRuntime (not a separate Fix AI). */
export type DiagnosticEvent = z.infer<typeof DiagnosticEvent>
/** Normalized diagnostic for the same AgentRuntime (not a separate Fix AI). */
export const DiagnosticEvent = AgentEventBase.extend({
  type: z.literal('diagnostic'),
  data: ViteDiagnostic,
})

/** Apply / mutation markers. */
export type ApplyOkEvent = z.infer<typeof ApplyOkEvent>
/** Apply / mutation markers. */
export const ApplyOkEvent = AgentEventBase.extend({
  type: z.literal('apply_ok'),
  data: z.object({ content: z.string() }),
})

/** Apply / mutation failure marker. */
export type ApplyFailedEvent = z.infer<typeof ApplyFailedEvent>
/** Apply / mutation failure marker. */
export const ApplyFailedEvent = AgentEventBase.extend({
  type: z.literal('apply_failed'),
  data: z.object({ content: z.string() }),
})

/** Non-recoverable AgentRuntime error (not model CoT). */
export type AgentErrorEvent = z.infer<typeof AgentErrorEvent>
/** Non-recoverable AgentRuntime error (not model CoT). */
export const AgentErrorEvent = AgentEventBase.extend({
  type: z.literal('agent_error'),
  data: z.object({ message: z.string() }),
})

/** Terminal event for one AgentRuntime generation. */
export type AgentDoneEvent = z.infer<typeof AgentDoneEvent>
/** Terminal event for one AgentRuntime generation. */
export const AgentDoneEvent = AgentEventBase.extend({
  type: z.literal('agent_done'),
  data: z.object({
    success: z.boolean(),
    gate: z
      .object({
        operation: z.enum(['mutation', 'read_only']),
        writesOk: z.boolean(),
        installOk: z.boolean(),
        buildOk: z.boolean(),
        previewHealthOk: z.boolean(),
        installRequired: z.boolean(),
      })
      .optional(),
  }),
})

/**
 * Legacy progress line — safe execution status only.
 * Must never carry private model reasoning / chain-of-thought.
 */
export type ProgressEvent = z.infer<typeof ProgressEvent>
/** Legacy progress line — safe execution status only. */
export const ProgressEvent = AgentEventBase.extend({
  type: z.literal('progress'),
  data: z.object({ content: z.string() }),
})

/**
 * Legacy timeline step — safe UI status only.
 * kind "thought" means user-facing status label, not model CoT payload.
 */
export type TimelineEvent = z.infer<typeof TimelineEvent>
/** Legacy timeline step — safe UI status only. */
export const TimelineEvent = AgentEventBase.extend({
  type: z.literal('timeline'),
  data: z.object({
    kind: z.enum(['thought', 'check', 'edit', 'verify', 'summary', 'terminal']),
    title: z.string(),
    detail: z.string().optional(),
    path: z.string().optional(),
    durationMs: z.number().optional(),
    status: z.enum(['running', 'done', 'failed']).optional(),
    id: z.string().optional(),
  }),
})

/** Visible build plan checklist for full product builds. */
export type BuildPlanEvent = z.infer<typeof BuildPlanEvent>
/** Visible build plan checklist for full product builds. */
export const BuildPlanEvent = AgentEventBase.extend({
  type: z.literal('build_plan'),
  data: z.object({
    brandName: z.string().optional(),
    vertical: z.string().optional(),
    items: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        status: z.enum(['pending', 'running', 'done', 'failed']).default('pending'),
      })
    ),
  }),
})

/** Schemas for every wire event type (canonical + legacy). */
export const AGENT_EVENT_SCHEMAS = {
  agent_start: AgentStartEvent,
  step_start: StepStartEvent,
  tool_start: ToolStartEvent,
  tool_result: ToolResultEvent,
  file_write: FileWriteEvent,
  file_patch: FilePatchEvent,
  command_start: CommandStartEvent,
  command_output: CommandOutputEvent,
  command_result: CommandResultEvent,
  build_start: BuildStartEvent,
  build_error: BuildErrorEvent,
  build_success: BuildSuccessEvent,
  preview_status: PreviewStatusEvent,
  diagnostic: DiagnosticEvent,
  apply_ok: ApplyOkEvent,
  apply_failed: ApplyFailedEvent,
  agent_error: AgentErrorEvent,
  agent_done: AgentDoneEvent,
  progress: ProgressEvent,
  timeline: TimelineEvent,
  build_plan: BuildPlanEvent,
} as const

/** Discriminated union of all Agent Runtime NDJSON events. */
export type AgentEvent = z.infer<typeof AgentEvent>
/** Discriminated union of all Agent Runtime NDJSON events. */
export const AgentEvent = z.discriminatedUnion('type', [
  AgentStartEvent,
  StepStartEvent,
  ToolStartEvent,
  ToolResultEvent,
  FileWriteEvent,
  FilePatchEvent,
  CommandStartEvent,
  CommandOutputEvent,
  CommandResultEvent,
  BuildStartEvent,
  BuildErrorEvent,
  BuildSuccessEvent,
  PreviewStatusEvent,
  DiagnosticEvent,
  ApplyOkEvent,
  ApplyFailedEvent,
  AgentErrorEvent,
  AgentDoneEvent,
  ProgressEvent,
  TimelineEvent,
  BuildPlanEvent,
])

/** Event type names that are frozen as the Agent Runtime protocol. */
export const CANONICAL_AGENT_EVENT_TYPES = [
  'agent_start',
  'step_start',
  'tool_start',
  'tool_result',
  'file_write',
  'file_patch',
  'command_start',
  'command_output',
  'command_result',
  'build_start',
  'build_error',
  'build_success',
  'preview_status',
  'diagnostic',
  'apply_ok',
  'apply_failed',
  'agent_error',
  'agent_done',
] as const

/** Event types that must never appear (private model CoT). */
export const FORBIDDEN_AGENT_EVENT_TYPES = [
  'thought',
  'thinking',
  'chain_of_thought',
  'reasoning',
  'done',
  'error',
  'build_result',
] as const

/**
 * Parse one NDJSON payload into a typed AgentEvent.
 * Returns null when the payload is not a valid Agent Runtime event.
 */
export function parseAgentEvent(raw: unknown): AgentEvent | null {
  const result = AgentEvent.safeParse(raw)
  return result.success ? result.data : null
}

/**
 * Build an authoritative file_write event.
 * Throws if persistedToSandbox is not true — prevents Phase 1 memory writes from pretending.
 */
export function createSandboxFileWriteEvent(input: {
  planId: string
  path: string
  bytes?: number
  description?: string
  ts?: number
}): FileWriteEvent {
  return FileWriteEvent.parse({
    type: 'file_write',
    version: AGENT_EVENT_VERSION,
    planId: input.planId,
    ts: input.ts,
    data: {
      path: input.path,
      bytes: input.bytes,
      description: input.description,
      persistedToSandbox: true,
    },
  })
}

/**
 * Build an authoritative file_patch event.
 * Throws if persistedToSandbox is not true — prevents RAM-only patches from pretending.
 */
export function createSandboxFilePatchEvent(input: {
  planId: string
  path: string
  bytes?: number
  description?: string
  ts?: number
}): FilePatchEvent {
  return FilePatchEvent.parse({
    type: 'file_patch',
    version: AGENT_EVENT_VERSION,
    planId: input.planId,
    ts: input.ts,
    data: {
      path: input.path,
      bytes: input.bytes,
      description: input.description,
      persistedToSandbox: true,
    },
  })
}
