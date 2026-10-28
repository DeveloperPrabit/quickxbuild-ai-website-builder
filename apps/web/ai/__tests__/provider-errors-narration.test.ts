import { describe, expect, it } from 'vitest'
import { consumeAiSdkFullStream, type StreamNarration } from '../agent/consume-tool-stream'
import { shouldFallBackToXmlCompatibility } from '../agent/generation-outcome'
import { describeProviderError, ProviderFatalError } from '../agent/provider-errors'
import { createRuntimeEmitter } from '../agent/runtime-emitter'

async function* parts(items: Array<Record<string, unknown>>) {
  for (const item of items) {
    yield item as { type: string }
  }
}

describe('provider error classification', () => {
  it('treats OpenAI credit exhaustion from the Responses stream as fatal', () => {
    const info = describeProviderError({
      type: 'error',
      error: {
        type: 'insufficient_quota',
        code: 'credit_balance_exhausted',
        message: 'You have no credits remaining.',
      },
    })
    expect(info.fatal).toBe(true)
    expect(info.code).toBe('credit_balance_exhausted')
    expect(info.message).toBe('You have no credits remaining.')
  })

  it('reads the error out of an API call responseBody', () => {
    const info = describeProviderError({
      statusCode: 401,
      message: 'Unauthorized',
      responseBody: JSON.stringify({ error: { code: 'invalid_api_key', message: 'Incorrect API key' } }),
    })
    expect(info.fatal).toBe(true)
    expect(info.code).toBe('invalid_api_key')
  })

  it('treats a rejected Gemini key (HTTP 400) as fatal', () => {
    const info = describeProviderError({
      statusCode: 400,
      responseBody: JSON.stringify([
        { error: { code: 400, message: 'API key not valid. Please pass a valid API key.' } },
      ]),
    })
    expect(info.fatal).toBe(true)
  })

  it('keeps rate limits and timeouts retryable', () => {
    expect(describeProviderError({ statusCode: 429, message: 'Rate limit reached' }).fatal).toBe(false)
    expect(describeProviderError(new Error('fetch failed')).fatal).toBe(false)
  })

  it('gives a readable user message for out-of-credit accounts', () => {
    const error = new ProviderFatalError('chat-model-reasoning-openai', {
      fatal: true,
      code: 'insufficient_quota',
      message: 'You have no credits remaining.',
    })
    expect(error.userMessage).toMatch(/out of credits/)
  })

  it('never falls back to XML when the provider refused the account', () => {
    expect(
      shouldFallBackToXmlCompatibility({
        mustApply: true,
        loopError: null,
        loopResult: {
          textStream: new ReadableStream(),
          applied: false,
          writes: [],
          providerError: { code: 'insufficient_quota', message: 'out of credits' },
        },
      })
    ).toBe(false)
  })
})

describe('stream narration', () => {
  it('emits assistant prose before a tool call and a reasoning summary with duration', async () => {
    const narrations: StreamNarration[] = []
    const result = await consumeAiSdkFullStream({
      fullStream: parts([
        { type: 'reasoning-start', id: 'r1' },
        { type: 'reasoning-delta', id: 'r1', text: 'The Services page lists NDIS first.' },
        { type: 'reasoning-end', id: 'r1' },
        { type: 'text-delta', id: 't1', text: 'Reading the About and Services pages.' },
        { type: 'tool-call', toolName: 'read_file', toolCallId: 'c1', input: { path: 'src/pages/Services.tsx', reason: 'Check layout' } },
        { type: 'tool-result', toolName: 'read_file', toolCallId: 'c1', output: 'file' },
      ]),
      emitter: createRuntimeEmitter('plan-1', () => {}),
      onNarration: (narration) => narrations.push(narration),
    })
    expect(result.streamError).toBeUndefined()
    expect(narrations.map((n) => n.kind)).toEqual(['reasoning', 'message'])
    expect(narrations[0]?.text).toContain('NDIS first')
    expect(typeof narrations[0]?.durationMs).toBe('number')
    expect(narrations[1]?.text).toBe('Reading the About and Services pages.')
  })

  it('skips XML file actions and reports stream errors with their real message', async () => {
    const narrations: StreamNarration[] = []
    const result = await consumeAiSdkFullStream({
      fullStream: parts([
        { type: 'text-delta', text: '<action type="file" filePath="a.tsx">x</action>' },
        {
          type: 'error',
          error: { type: 'error', error: { code: 'insufficient_quota', message: 'No credits' } },
        },
      ]),
      emitter: createRuntimeEmitter('plan-1', () => {}),
      onNarration: (narration) => narrations.push(narration),
    })
    expect(narrations).toEqual([])
    expect(result.streamError).toBe('No credits')
    expect(result.streamErrorInfo?.fatal).toBe(true)
  })
})
