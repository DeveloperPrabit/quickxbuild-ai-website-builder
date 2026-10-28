/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * agent-runtime-streaming.test.ts — Phase 1 integration: events before completion
 *
 * Proves consumeAiSdkFullStream emits tool_start/tool_result while the fake
 * stream is still open, before agent_done. Not a capability-flag stub.
 */

import { describe, expect, it } from 'vitest'
import { consumeAiSdkFullStream, type AiSdkStreamPart } from '../agent/consume-tool-stream'
import { createRuntimeEmitter } from '../agent/runtime-emitter'
import { AGENT_EVENT_VERSION, parseAgentEvent } from '../agent/runtime-events'
import { AGENT_RUNTIME_CAPABILITIES } from '../agent/runtime-capabilities'

async function* delayedParts(
  parts: AiSdkStreamPart[],
  delayMs: number,
  onAfterIndex?: (index: number, emittedSoFar: string[]) => void
): AsyncGenerator<AiSdkStreamPart> {
  for (let i = 0; i < parts.length; i++) {
    await new Promise((r) => setTimeout(r, delayMs))
    yield parts[i]!
    onAfterIndex?.(i, [])
  }
}

describe('Phase 1 Agent Runtime streaming', () => {
  it('emits tool_start and tool_result before agent_done (stream still open mid-run)', async () => {
    const seen: string[] = []
    const midRunSnapshot: string[] = []
    let midCaptured = false

    const emitter = createRuntimeEmitter('plan-stream-1', (event) => {
      seen.push(event.type)
      expect(event.version).toBe(AGENT_EVENT_VERSION)
      expect(event.planId).toBe('plan-stream-1')
    })

    emitter.agentStart('mutation')

    const parts: AiSdkStreamPart[] = [
      { type: 'start' },
      { type: 'start-step' },
      { type: 'tool-input-start', id: 'c1', toolName: 'read_file' },
      {
        type: 'tool-call',
        toolCallId: 'c1',
        toolName: 'read_file',
        input: { path: 'src/App.tsx' },
      },
      {
        type: 'tool-result',
        toolCallId: 'c1',
        toolName: 'read_file',
        input: { path: 'src/App.tsx' },
        output: 'ok',
      },
      { type: 'text-delta', text: 'done' },
      { type: 'finish' },
    ]

    const consumePromise = consumeAiSdkFullStream({
      fullStream: delayedParts(parts, 15, (index) => {
        // After tool-result (index 4), stream is not finished yet
        if (index === 4 && !midCaptured) {
          midCaptured = true
          midRunSnapshot.push(...seen)
        }
      }),
      emitter,
    })

    const result = await consumePromise
    emitter.agentDone(true)

    expect(result.text).toBe('done')
    expect(midCaptured).toBe(true)
    // Proof: tool events existed before terminal agent_done
    expect(midRunSnapshot).toContain('agent_start')
    expect(midRunSnapshot).toContain('tool_start')
    expect(midRunSnapshot).toContain('tool_result')
    expect(midRunSnapshot).not.toContain('agent_done')

    expect(seen.indexOf('tool_start')).toBeLessThan(seen.indexOf('tool_result'))
    expect(seen.indexOf('tool_result')).toBeLessThan(seen.indexOf('agent_done'))
    expect(seen.filter((t) => t === 'agent_done')).toHaveLength(1)
  })

  it('preserves order across multiple tools', async () => {
    const seen: string[] = []
    const emitter = createRuntimeEmitter('plan-multi', (event) => {
      if (event.type === 'tool_start' || event.type === 'tool_result') {
        seen.push(`${event.type}:${event.data.tool}`)
      }
    })

    await consumeAiSdkFullStream({
      fullStream: delayedParts(
        [
          { type: 'tool-call', toolCallId: 'a', toolName: 'list_dir', input: {} },
          { type: 'tool-result', toolCallId: 'a', toolName: 'list_dir', output: 'ok' },
          {
            type: 'tool-call',
            toolCallId: 'b',
            toolName: 'write_file',
            input: { path: 'src/x.tsx', content: 'x' },
          },
          {
            type: 'tool-result',
            toolCallId: 'b',
            toolName: 'write_file',
            input: { path: 'src/x.tsx' },
            output: 'Wrote',
          },
        ],
        5
      ),
      emitter,
    })

    expect(seen).toEqual([
      'tool_start:list_dir',
      'tool_result:list_dir',
      'tool_start:write_file',
      'tool_result:write_file',
    ])
  })

  it('does not emit private CoT from reasoning parts', async () => {
    const types: string[] = []
    const emitter = createRuntimeEmitter('plan-cot', (event) => {
      types.push(event.type)
    })

    await consumeAiSdkFullStream({
      fullStream: delayedParts(
        [
          { type: 'reasoning-start', id: 'r1' },
          { type: 'reasoning-delta', id: 'r1', text: 'secret chain of thought' },
          { type: 'reasoning-end', id: 'r1' },
          { type: 'tool-call', toolName: 'read_file', toolCallId: 't1', input: { path: 'a' } },
          { type: 'tool-result', toolName: 'read_file', toolCallId: 't1', output: 'x' },
        ],
        2
      ),
      emitter,
    })

    expect(types).not.toContain('thought')
    expect(types).not.toContain('thinking')
    expect(types.some((t) => t.includes('reason'))).toBe(false)
    expect(types).toContain('tool_start')
    expect(types).toContain('tool_result')
  })

  it('abort does not emit agent_done success via consumer (caller emits agent_error)', async () => {
    const controller = new AbortController()
    const types: string[] = []
    const emitter = createRuntimeEmitter('plan-abort', (event) => {
      types.push(event.type)
    })

    async function* abortingStream(): AsyncGenerator<AiSdkStreamPart> {
      yield { type: 'tool-call', toolName: 'read_file', toolCallId: 't', input: { path: 'a' } }
      controller.abort()
      yield { type: 'tool-result', toolName: 'read_file', toolCallId: 't', output: 'x' }
      yield { type: 'finish' }
    }

    const result = await consumeAiSdkFullStream({
      fullStream: abortingStream(),
      emitter,
      abortSignal: controller.signal,
    })

    expect(result.aborted).toBe(true)
    emitter.agentError('Request aborted')
    expect(types).toContain('agent_error')
    expect(types).not.toContain('agent_done')
  })

  it('rejects malformed events at the emitter boundary', () => {
    const accepted: string[] = []
    const emitter = createRuntimeEmitter('plan-bad', (event) => {
      accepted.push(event.type)
    })
    emitter.emit({ type: 'thought', data: { secret: true } })
    emitter.emit({ type: 'done', data: { success: true } })
    emitter.emit({ type: 'build_result', data: {} })
    emitter.emit({
      type: 'file_write',
      data: { path: 'x', persistedToSandbox: false },
    })
    expect(accepted).toEqual([])
    expect(parseAgentEvent({ type: 'thinking', planId: 'x', version: 1 })).toBeNull()
  })

  it('never emits authoritative file_write from Phase 1 stream consumer', async () => {
    const types: string[] = []
    const emitter = createRuntimeEmitter('plan-nofile', (event) => {
      types.push(event.type)
    })
    await consumeAiSdkFullStream({
      fullStream: delayedParts(
        [
          {
            type: 'tool-call',
            toolName: 'write_file',
            toolCallId: 'w',
            input: { path: 'src/App.tsx', content: 'export default function App(){return null}' },
          },
          {
            type: 'tool-result',
            toolName: 'write_file',
            toolCallId: 'w',
            output: 'Wrote src/App.tsx',
          },
        ],
        2
      ),
      emitter,
    })
    expect(types).toContain('tool_start')
    expect(types).toContain('tool_result')
    expect(types).not.toContain('file_write')
    expect(types).not.toContain('file_patch')
  })

  it('NDJSON lines validate as AgentEvent with version 1 and stable planId', () => {
    const lines: string[] = []
    const sink = createRuntimeEmitter('plan-ndjson', (event) => {
      lines.push(JSON.stringify(event))
    })
    sink.agentStart('mutation')
    sink.toolStart('read_file', 'src/App.tsx')
    sink.toolResult('read_file', true, 'src/App.tsx')
    sink.agentDone(true)

    const parsed = lines.map((line) => parseAgentEvent(JSON.parse(line)))
    expect(parsed.every(Boolean)).toBe(true)
    expect(parsed.every((e) => e?.version === 1)).toBe(true)
    expect(parsed.every((e) => e?.planId === 'plan-ndjson')).toBe(true)
    expect(parsed.map((e) => e?.type)).toEqual([
      'agent_start',
      'tool_start',
      'tool_result',
      'agent_done',
    ])
  })
})

describe('Phase 1 capability flip gate', () => {
  it('documents streamedToolEvents must be true only after this suite proves streaming', () => {
    // This file IS the proof. The capability matrix is flipped in runtime-capabilities.ts
    // after these tests pass in CI/local — see that file.
    expect(typeof AGENT_RUNTIME_CAPABILITIES.streamedToolEvents).toBe('boolean')
  })
})
