/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * ndjson-line-buffer.test.ts — regression for mid-chunk JSON.parse crashes
 */

import { describe, expect, it } from 'vitest'

/**
 * Mirror of llmGenerate NDJSON buffering: split chunks must not JSON.parse
 * until a full line arrives (fixes Unterminated string in JSON).
 */
async function parseNdjsonChunks(chunks: string[]): Promise<unknown[]> {
  const out: unknown[] = []
  let lineBuffer = ''
  for (const chunk of chunks) {
    lineBuffer += chunk
    const lines = lineBuffer.split('\n')
    lineBuffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      out.push(JSON.parse(trimmed))
    }
  }
  const trimmed = lineBuffer.trim()
  if (trimmed) {
    out.push(JSON.parse(trimmed))
  }
  return out
}

describe('NDJSON line buffer', () => {
  it('parses a JSON object split across chunks mid-string', async () => {
    const full = `${JSON.stringify({ type: 'thinking', data: { content: 'hello world' } })}\n`
    const mid = Math.floor(full.length / 2)
    const events = await parseNdjsonChunks([full.slice(0, mid), full.slice(mid)])
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'thinking' })
  })

  it('parses multiple lines arriving in one chunk', async () => {
    const a = JSON.stringify({ type: 'progress', data: { content: 'a' } })
    const b = JSON.stringify({ type: 'progress', data: { content: 'b' } })
    const events = await parseNdjsonChunks([`${a}\n${b}\n`])
    expect(events).toHaveLength(2)
  })
})
