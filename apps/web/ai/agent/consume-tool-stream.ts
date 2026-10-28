/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * consume-tool-stream.ts — Incremental AI SDK fullStream → Agent Runtime events (Phase 1)
 *
 * Consumes streamText().fullStream part-by-part.
 * Emits tool_start / tool_result / step_start while the stream is still open.
 * file_write / file_patch are emitted by the tool persist path (Phase 2), not here.
 * Visible narration (assistant text before tool calls, provider reasoning summaries) is
 * forwarded through onNarration so the Details timeline can explain what the agent is doing.
 */

import { describeProviderError, type ProviderErrorInfo } from './provider-errors'
import type { RuntimeEmitter } from './runtime-emitter'

export type AiSdkStreamPart = {
  type: string
  toolName?: string
  toolCallId?: string
  input?: unknown
  args?: unknown
  output?: unknown
  result?: unknown
  error?: unknown
  text?: string
  delta?: string
  id?: string
}

export type StreamNarration = {
  /** "reasoning" = provider reasoning summary; "message" = assistant prose between tool calls. */
  kind: 'reasoning' | 'message'
  text: string
  durationMs?: number
}

export type ConsumeToolStreamResult = {
  text: string
  aborted: boolean
  streamError?: string
  /** Classified provider error, when the stream reported one. */
  streamErrorInfo?: ProviderErrorInfo
  /** Tool names observed in order (start then result pairs). */
  toolSequence: string[]
}

const MAX_NARRATION_CHARS = 1200

function toolPathFromInput(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined
  const { path, query } = input as { path?: unknown; query?: unknown }
  if (typeof path === 'string') return path
  return typeof query === 'string' ? `"${query.slice(0, 60)}"` : undefined
}

function toolDescriptionFromInput(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined
  const { description, reason } = input as { description?: unknown; reason?: unknown }
  const value = typeof description === 'string' ? description : reason
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : undefined
}

/** Detect structured Phase 2 failure payloads from write_file / apply_patch. */
function toolOutputOk(output: unknown): boolean {
  if (output && typeof output === 'object' && 'ok' in output) {
    return (output as { ok: unknown }).ok === true
  }
  return true
}

/** Prose worth showing: skip XML file actions, code dumps and empty whitespace. */
function cleanNarration(raw: string): string | null {
  const text = raw.trim()
  if (text.length < 3) return null
  if (/<action\b|<quickxbuildArtifact|<plan\b|```/i.test(text)) return null
  return text.length > MAX_NARRATION_CHARS ? `${text.slice(0, MAX_NARRATION_CHARS)}…` : text
}

/**
 * Walk an AI SDK fullStream asynchronously, emitting Agent Runtime events live.
 * Safe to unit-test with a fake AsyncIterable of AiSdkStreamPart.
 */
export async function consumeAiSdkFullStream(input: {
  fullStream: AsyncIterable<AiSdkStreamPart>
  emitter: RuntimeEmitter
  abortSignal?: AbortSignal
  onNarration?: (narration: StreamNarration) => void
}): Promise<ConsumeToolStreamResult> {
  let text = ''
  let aborted = false
  let streamError: string | undefined
  let streamErrorInfo: ProviderErrorInfo | undefined
  const toolSequence: string[] = []
  const openTools = new Map<string, { tool: string; path?: string; description?: string }>()
  let pendingText = ''
  let reasoningText = ''
  let reasoningStartedAt: number | null = null

  const flushText = () => {
    const cleaned = cleanNarration(pendingText)
    pendingText = ''
    if (cleaned) input.onNarration?.({ kind: 'message', text: cleaned })
  }
  const flushReasoning = () => {
    const cleaned = cleanNarration(reasoningText)
    const durationMs = reasoningStartedAt ? Date.now() - reasoningStartedAt : undefined
    reasoningText = ''
    reasoningStartedAt = null
    if (cleaned) input.onNarration?.({ kind: 'reasoning', text: cleaned, durationMs })
  }

  try {
    for await (const part of input.fullStream) {
      if (input.abortSignal?.aborted) {
        aborted = true
        break
      }

      switch (part.type) {
        case 'start':
          input.emitter.stepStart('model', 'Model step')
          break
        case 'start-step':
          input.emitter.stepStart('step', 'Model tool step')
          break
        case 'finish-step':
          flushReasoning()
          flushText()
          break
        case 'tool-input-start': {
          flushReasoning()
          flushText()
          const tool = part.toolName || 'tool'
          const callId = part.id || `${tool}-${toolSequence.length}`
          openTools.set(callId, { tool })
          toolSequence.push(`start:${tool}`)
          input.emitter.toolStart(tool)
          break
        }
        case 'tool-call': {
          flushReasoning()
          flushText()
          const tool = part.toolName || 'tool'
          const path = toolPathFromInput(part.input ?? part.args)
          const callId = part.toolCallId || part.id || `${tool}-${toolSequence.length}`
          // Avoid duplicate start if tool-input-start already fired
          if (!openTools.has(callId)) {
            toolSequence.push(`start:${tool}`)
            input.emitter.toolStart(tool, path)
          } else {
            const prev = openTools.get(callId)
            if (prev) openTools.set(callId, { ...prev, path: path || prev.path })
            // Path often arrives only on tool-call after tool-input-start — refresh Details UI.
            if (path) {
              input.emitter.toolStart(tool, path)
            }
          }
          openTools.set(callId, {
            tool,
            path: path || openTools.get(callId)?.path,
            description: toolDescriptionFromInput(part.input ?? part.args),
          })
          break
        }
        case 'tool-result': {
          const tool = part.toolName || 'tool'
          const open = openTools.get(part.toolCallId || part.id || '')
          const path = toolPathFromInput(part.input ?? part.args) || open?.path
          const description = toolDescriptionFromInput(part.input ?? part.args) || open?.description
          const output = part.output ?? part.result
          const ok = toolOutputOk(output)
          toolSequence.push(`result:${tool}`)
          input.emitter.toolResult(
            tool,
            ok,
            path,
            ok
              ? description
              : typeof output === 'object' &&
                  output &&
                  'error' in output &&
                  typeof (output as { error?: unknown }).error === 'string'
                ? (output as { error: string }).error
                : typeof output === 'object' &&
                    output &&
                    'message' in output &&
                    typeof (output as { message?: unknown }).message === 'string'
                  ? (output as { message: string }).message
                  : 'tool failed'
          )
          openTools.delete(part.toolCallId || part.id || '')
          break
        }
        case 'tool-error': {
          const tool = part.toolName || 'tool'
          toolSequence.push(`result:${tool}`)
          input.emitter.toolResult(
            tool,
            false,
            undefined,
            part.error instanceof Error ? part.error.message : String(part.error ?? 'tool error')
          )
          break
        }
        case 'text-delta': {
          const delta = typeof part.text === 'string' ? part.text : part.delta
          if (typeof delta === 'string') {
            text += delta
            pendingText += delta
          }
          break
        }
        case 'reasoning-start':
          reasoningStartedAt ??= Date.now()
          break
        case 'reasoning-delta': {
          reasoningStartedAt ??= Date.now()
          const delta = typeof part.text === 'string' ? part.text : part.delta
          if (typeof delta === 'string') reasoningText += delta
          break
        }
        case 'reasoning-end':
          // Summaries can arrive in several parts; keep a blank line between them.
          if (reasoningText && !reasoningText.endsWith('\n\n')) reasoningText += '\n\n'
          break
        case 'abort':
          aborted = true
          break
        case 'error':
          streamErrorInfo = describeProviderError(part.error)
          streamError = streamErrorInfo.message
          break
        default:
          break
      }
    }
  } catch (error) {
    if (input.abortSignal?.aborted) {
      aborted = true
    } else {
      streamErrorInfo = describeProviderError(error)
      streamError = streamErrorInfo.message
    }
  }

  flushReasoning()
  flushText()

  if (input.abortSignal?.aborted) {
    aborted = true
  }

  return { text, aborted, streamError, streamErrorInfo, toolSequence }
}
