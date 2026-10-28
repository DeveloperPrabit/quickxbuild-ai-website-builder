import { afterEach, describe, expect, it } from 'vitest'
import { describeProviderError } from '../agent/provider-errors'
import {
  SKIP_THOUGHT_SIGNATURE,
  dailyQuotaAsFatal,
  patchGeminiRequestBody,
  resetGeminiSignatureCache,
  transformGeminiSse,
} from '../gemini-compat-fetch'

function sseBody(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text)
  return new ReadableStream({
    start(controller) {
      // Split mid-line to exercise buffering.
      controller.enqueue(bytes.slice(0, 40))
      controller.enqueue(bytes.slice(40))
      controller.close()
    },
  })
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text()
}

const toolChunk = (id: string, name: string) =>
  `data: ${JSON.stringify({
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            {
              id,
              type: 'function',
              function: { name, arguments: '{"path":"src/App.tsx"}' },
              extra_content: { google: { thought_signature: `sig-${id}` } },
            },
          ],
        },
      },
    ],
  })}\n\n`

describe('gemini compat fetch', () => {
  afterEach(() => resetGeminiSignatureCache())

  it('adds a distinct index to each streamed tool call', async () => {
    const out = await readAll(
      transformGeminiSse(sseBody(`${toolChunk('call_a', 'read_file')}${toolChunk('call_b', 'write_file')}data: [DONE]\n\n`))
    )
    const chunks = out
      .split('\n')
      .filter((line) => line.startsWith('data: {'))
      .map((line) => JSON.parse(line.slice(6)))
    expect(chunks.map((c) => c.choices[0].delta.tool_calls[0].index)).toEqual([0, 1])
    expect(out).toContain('data: [DONE]')
  })

  it('turns a per-day quota 429 into a non-retryable fatal error but keeps per-minute 429s', async () => {
    const daily = await dailyQuotaAsFatal(
      new Response(
        '[{"error":{"code":429,"message":"Quota exceeded. Please retry in 11h31m53.7s.","details":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier","quotaDimensions":{"model":"gemini-3.8-flash"}}]}}]',
        { status: 429 }
      )
    )
    expect(daily.status).toBe(402)
    const info = describeProviderError({ statusCode: 402, responseBody: await daily.text() })
    expect(info).toMatchObject({ fatal: true, code: 'daily_quota_exhausted' })
    expect(info.message).toContain('resets in about 11h31m')

    const perMinute = await dailyQuotaAsFatal(new Response('{"error":{"code":429}}', { status: 429 }))
    expect(perMinute.status).toBe(429)
  })

  it('sends back the thought signature Gemini issued, or the documented placeholder', async () => {
    await readAll(transformGeminiSse(sseBody(toolChunk('call_a', 'read_file'))))
    const body = JSON.stringify({
      messages: [
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          tool_calls: [
            { id: 'call_a', type: 'function', function: { name: 'read_file', arguments: '{}' } },
            { id: 'call_x', type: 'function', function: { name: 'read_file', arguments: '{}' } },
          ],
        },
      ],
    })
    const patched = JSON.parse(patchGeminiRequestBody(body))
    const calls = patched.messages[1].tool_calls
    expect(calls[0].extra_content.google.thought_signature).toBe('sig-call_a')
    expect(calls[1].extra_content.google.thought_signature).toBe(SKIP_THOUGHT_SIGNATURE)
  })
})
