/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * gemini-compat-fetch.ts — Bridge Gemini's OpenAI-compatible endpoint to the AI SDK chat client
 *
 * Gemini streams tool calls without the `index` field the AI SDK schema requires, and Gemini 3
 * rejects follow-up turns whose assistant tool calls lack the `thought_signature` it issued.
 */

/** Documented placeholder Gemini accepts when the real signature is unavailable. */
export const SKIP_THOUGHT_SIGNATURE = 'skip_thought_signature_validator'

const MAX_CACHED_SIGNATURES = 500
const signaturesByCallId = new Map<string, string>()

type ToolCallDelta = {
  index?: number
  id?: string
  extra_content?: { google?: { thought_signature?: string } }
  [key: string]: unknown
}

type StreamState = { nextIndex: number; lastIndex: number; indexById: Map<string, number> }

export function createStreamState(): StreamState {
  return { nextIndex: 0, lastIndex: -1, indexById: new Map() }
}

function rememberSignature(callId: string, signature: string): void {
  signaturesByCallId.set(callId, signature)
  if (signaturesByCallId.size > MAX_CACHED_SIGNATURES) {
    const oldest = signaturesByCallId.keys().next().value
    if (oldest !== undefined) signaturesByCallId.delete(oldest)
  }
}

/** Give every streamed tool call a stable `index` and remember its thought signature. */
export function fixGeminiChunk(chunk: unknown, state: StreamState): unknown {
  const choices = (chunk as { choices?: { delta?: { tool_calls?: ToolCallDelta[] } }[] })?.choices
  if (!Array.isArray(choices)) return chunk
  for (const choice of choices) {
    const calls = choice?.delta?.tool_calls
    if (!Array.isArray(calls)) continue
    for (const call of calls) {
      const signature = call.extra_content?.google?.thought_signature
      if (call.id && signature) rememberSignature(call.id, signature)
      if (typeof call.index === 'number') continue
      if (call.id) {
        const known = state.indexById.get(call.id)
        const index = known ?? state.nextIndex++
        state.indexById.set(call.id, index)
        call.index = index
      } else {
        call.index = state.lastIndex >= 0 ? state.lastIndex : state.nextIndex++
      }
      state.lastIndex = call.index
    }
  }
  return chunk
}

function fixSseLine(line: string, state: StreamState): string {
  if (!line.startsWith('data:')) return line
  const payload = line.slice(5).trim()
  if (!payload || payload === '[DONE]') return line
  try {
    return `data: ${JSON.stringify(fixGeminiChunk(JSON.parse(payload), state))}`
  } catch {
    return line
  }
}

export function transformGeminiSse(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const state = createStreamState()
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(bytes, controller) {
        buffer += decoder.decode(bytes, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        if (lines.length > 0) {
          controller.enqueue(encoder.encode(`${lines.map((l) => fixSseLine(l, state)).join('\n')}\n`))
        }
      },
      flush(controller) {
        buffer += decoder.decode()
        if (buffer) controller.enqueue(encoder.encode(fixSseLine(buffer, state)))
      },
    })
  )
}

/** Re-attach thought signatures to assistant tool calls the AI SDK sends back. */
export function patchGeminiRequestBody(body: string): string {
  let parsed: { messages?: { role?: string; tool_calls?: ToolCallDelta[] }[] }
  try {
    parsed = JSON.parse(body)
  } catch {
    return body
  }
  let changed = false
  for (const message of parsed.messages ?? []) {
    if (message.role !== 'assistant' || !Array.isArray(message.tool_calls)) continue
    for (const call of message.tool_calls) {
      if (call.extra_content?.google?.thought_signature) continue
      const signature = (call.id && signaturesByCallId.get(call.id)) || SKIP_THOUGHT_SIGNATURE
      call.extra_content = { ...call.extra_content, google: { thought_signature: signature } }
      changed = true
    }
  }
  return changed ? JSON.stringify(parsed) : body
}

/**
 * A per-day quota 429 will not clear within the SDK's retry window, so surface it as a
 * non-retryable 402 with a readable message instead of burning a minute on backoff.
 * Per-minute 429s pass through untouched and are retried.
 */
export async function dailyQuotaAsFatal(response: Response): Promise<Response> {
  const body = await response.text()
  if (!/PerDay/i.test(body)) {
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }
  const model = body.match(/"model":\s*"([^"]+)"/)?.[1] ?? 'Gemini'
  const retryIn = body.match(/retry in ((?:\d+h)?(?:\d+m)?)/i)?.[1]
  const message = `Gemini daily request limit reached for ${model} (free tier).${retryIn ? ` It resets in about ${retryIn}.` : ''} Enable billing on the Gemini project or add OpenAI credits.`
  return new Response(JSON.stringify({ error: { code: 'daily_quota_exhausted', message } }), {
    status: 402,
    statusText: 'Daily quota exhausted',
    headers: { 'content-type': 'application/json' },
  })
}

export async function geminiCompatFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const requestBody = typeof init?.body === 'string' ? init.body : undefined
  const response = await fetch(
    input,
    requestBody ? { ...init, body: patchGeminiRequestBody(requestBody) } : init
  )
  if (response.status === 429) return dailyQuotaAsFatal(response)
  const streaming =
    (response.headers.get('content-type') ?? '').includes('event-stream') ||
    /"stream"\s*:\s*true/.test(requestBody ?? '')
  if (!response.ok || !response.body || !streaming) return response
  return new Response(transformGeminiSse(response.body), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

/** Test hook. */
export function resetGeminiSignatureCache(): void {
  signaturesByCallId.clear()
}
