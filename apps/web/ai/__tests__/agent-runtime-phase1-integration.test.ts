/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * agent-runtime-phase1-integration.test.ts
 *
 * Phase 1 acceptance: real runAgentLoop wiring with a hold-open fake AI SDK stream.
 * Proves tool events reach onAgentEvent / NDJSON BEFORE agent_done while fullStream is open.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

type StreamPart = Record<string, unknown>

function createHoldOpenStream() {
  const queue: StreamPart[] = []
  let closed = false
  let wake: (() => void) | null = null

  const signal = () => {
    wake?.()
    wake = null
  }

  return {
    get open() {
      return !closed
    },
    push(part: StreamPart) {
      if (closed) return
      queue.push(part)
      signal()
    },
    close() {
      closed = true
      signal()
    },
    async *[Symbol.asyncIterator]() {
      while (true) {
        while (queue.length === 0 && !closed) {
          await new Promise<void>((resolve) => {
            wake = resolve
          })
        }
        if (queue.length === 0 && closed) {
          return
        }
        yield queue.shift() as StreamPart
      }
    },
  }
}

const holdOpen: { current: ReturnType<typeof createHoldOpenStream> | null } = {
  current: null,
}
let streamTextCallCount = 0

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()
  return {
    ...actual,
    streamText: vi.fn(() => {
      streamTextCallCount += 1
      if (streamTextCallCount === 1 && holdOpen.current) {
        return {
          fullStream: holdOpen.current,
          text: Promise.resolve(''),
          steps: Promise.resolve([]),
          toolCalls: Promise.resolve([]),
        }
      }
      return {
        fullStream: (async function* empty() {})(),
        text: Promise.resolve(''),
        steps: Promise.resolve([]),
        toolCalls: Promise.resolve([]),
      }
    }),
  }
})

vi.mock('../agent/cursor-bridge', () => ({
  isCursorAgentEnabled: () => false,
  runCursorBackendAgent: async () => null,
}))

import { runAgentLoop } from '../agent/loop'
import {
  AI_RUNTIME_NDJSON_CONTENT_TYPE,
  createNdjsonAgentEventForwarder,
  encodeAgentEventNdjsonLine,
} from '../agent/runtime-ndjson'
import { parseAgentEvent, type AgentEvent } from '../agent/runtime-events'
import { AGENT_RUNTIME_CAPABILITIES } from '../agent/runtime-capabilities'

async function waitUntil(predicate: () => boolean, timeoutMs = 8000) {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('waitUntil timed out')
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('Phase 1 real runtime integration (runAgentLoop → NDJSON)', () => {
  beforeEach(() => {
    streamTextCallCount = 0
    holdOpen.current = createHoldOpenStream()
  })

  it('uses application/x-ndjson for the Agent Runtime stream', () => {
    expect(AI_RUNTIME_NDJSON_CONTENT_TYPE).toBe('application/x-ndjson')
  })

  it('emits tool events over NDJSON while the model fullStream is still open', async () => {
    const planId = 'plan-phase1-integration'
    const events: AgentEvent[] = []
    const ndjsonBytes: Uint8Array[] = []
    const forward = createNdjsonAgentEventForwarder((bytes) => {
      ndjsonBytes.push(bytes)
    })

    const loopPromise = runAgentLoop({
      // Read-only so we do not enter write/XML retry storms after the first stream.
      prompt: 'what is React Query?',
      xmlFiles: '<files></files>',
      fileMap: {
        'src/App.tsx': { content: 'export default function App() { return null }' },
      },
      userPlan: 'FREE',
      planId,
      onAgentEvent: (event) => {
        events.push(event)
        forward(event)
      },
    })

    await waitUntil(() => events.some((event) => event.type === 'agent_start'))
    expect(holdOpen.current?.open).toBe(true)

    holdOpen.current?.push({ type: 'start' })
    holdOpen.current?.push({
      type: 'tool-call',
      toolCallId: 'call-1',
      toolName: 'read_file',
      input: { path: 'src/App.tsx' },
    })
    holdOpen.current?.push({
      type: 'tool-result',
      toolCallId: 'call-1',
      toolName: 'read_file',
      input: { path: 'src/App.tsx' },
      output: 'export default function App() { return null }',
    })

    await waitUntil(() => events.some((event) => event.type === 'tool_result'))

    // Critical Phase 1 proof: stream still open and terminal event not yet emitted
    expect(holdOpen.current?.open).toBe(true)
    const midTypes = events.map((event) => event.type)
    expect(midTypes).toContain('agent_start')
    expect(midTypes).toContain('tool_start')
    expect(midTypes).toContain('tool_result')
    expect(midTypes).not.toContain('agent_done')
    expect(midTypes).not.toContain('agent_error')
    expect(midTypes).not.toContain('file_write')
    expect(midTypes).not.toContain('file_patch')
    expect(midTypes).not.toContain('thought')
    expect(midTypes).not.toContain('thinking')

    const midNdjson = new TextDecoder()
      .decode(Buffer.concat(ndjsonBytes.map((chunk) => Buffer.from(chunk))))
      .trim()
      .split('\n')
      .filter(Boolean)
    expect(midNdjson.length).toBeGreaterThanOrEqual(3)
    for (const line of midNdjson) {
      const parsed = parseAgentEvent(JSON.parse(line))
      expect(parsed).not.toBeNull()
      expect(parsed?.version).toBe(1)
      expect(parsed?.planId).toBe(planId)
    }

    holdOpen.current?.close()
    await loopPromise

    const finalTypes = events.map((event) => event.type)
    expect(finalTypes).toContain('agent_done')
    expect(finalTypes.indexOf('tool_start')).toBeLessThan(finalTypes.indexOf('tool_result'))
    expect(finalTypes.indexOf('tool_result')).toBeLessThan(finalTypes.indexOf('agent_done'))
    expect(finalTypes).not.toContain('file_write')
    expect(finalTypes).not.toContain('file_patch')

    expect(events.every((event) => event.version === 1)).toBe(true)
    expect(events.every((event) => event.planId === planId)).toBe(true)

    const allLines = new TextDecoder()
      .decode(Buffer.concat(ndjsonBytes.map((chunk) => Buffer.from(chunk))))
      .trim()
      .split('\n')
      .filter(Boolean)
    expect(allLines.at(-1)).toContain('"type":"agent_done"')
    expect(encodeAgentEventNdjsonLine({ type: 'probe' }).endsWith('\n')).toBe(true)
  })

  it('keeps Phase 1–4 capabilities; Phase 6+/RAG remain off', () => {
    expect(AGENT_RUNTIME_CAPABILITIES.contracts).toBe(true)
    expect(AGENT_RUNTIME_CAPABILITIES.streamedToolEvents).toBe(true)
    expect(AGENT_RUNTIME_CAPABILITIES.immediateSandboxPersist).toBe(true)
    expect(AGENT_RUNTIME_CAPABILITIES.projectMutationLock).toBe(true)
    expect(AGENT_RUNTIME_CAPABILITIES.installBuildRepair).toBe(true)
    expect(AGENT_RUNTIME_CAPABILITIES.viteDiagnostics).toBe(true)
    expect(AGENT_RUNTIME_CAPABILITIES.successGateEnforced).toBe(true)
    expect(AGENT_RUNTIME_CAPABILITIES.xmlAdapterOnly).toBe(true)
    expect(AGENT_RUNTIME_CAPABILITIES.failClosedSmoke).toBe(false)
    expect(AGENT_RUNTIME_CAPABILITIES.e2eAcceptance).toBe(false)
    expect(AGENT_RUNTIME_CAPABILITIES.ragEnabled).toBe(false)
  })
})
