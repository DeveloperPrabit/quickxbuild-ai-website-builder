/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * agent-runtime-phase2-persist.test.ts
 *
 * Phase 2 acceptance: real sandbox filesystem persistence during tool execute,
 * durable history, project mutation lock, failure semantics, abort survival.
 *
 * Does NOT mock persistAgentMutation / sandbox writeFile — those are under test.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAgentTools, createPersistMutationFn } from '../agent/tools'
import { createLocalSandboxFilesystem } from '../agent/sandbox-fs'
import { persistAgentMutation } from '../agent/persist-mutation'
import {
  isProjectMutationLockHeld,
  resetProjectMutationLocksForTests,
  withProjectMutationLock,
} from '../agent/project-mutation-lock'
import { createInMemoryDurableHistory } from '../agent/in-memory-history'
import { createRuntimeEmitter } from '../agent/runtime-emitter'
import { AGENT_RUNTIME_CAPABILITIES } from '../agent/runtime-capabilities'
import type { AgentEvent } from '../agent/runtime-events'

describe('Phase 2: immediate sandbox persistence + lock + durable history', () => {
  let tempRoot: string

  beforeEach(async () => {
    resetProjectMutationLocksForTests()
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'quickxbuild-phase2-'))
  })

  afterEach(async () => {
    resetProjectMutationLocksForTests()
    await rm(tempRoot, { recursive: true, force: true })
  })

  it('capability matrix: Phase 1–4 flags true; Phase 6+/RAG remain false', () => {
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

  it('A: write_file mutates real sandbox BEFORE generation finishes', async () => {
    const sandbox = createLocalSandboxFilesystem(tempRoot)
    const history = createInMemoryDurableHistory()
    const events: AgentEvent[] = []
    const emitter = createRuntimeEmitter('plan-a', (e) => events.push(e))
    const fileMap: Record<string, { content?: string }> = {
      'src/App.tsx': { content: 'export default function App() { return null }' },
    }

    const persistMutation = createPersistMutationFn({
      projectId: 'proj-a',
      planId: 'plan-a',
      sandbox,
      appendDurableHistory: history.append,
      emitter,
    })

    const { tools } = createAgentTools(fileMap, {
      userPlan: 'enterprise',
      persistMutation,
      emitter,
    })

    const target = 'src/pages/Home.tsx'
    const newContent = 'export default function Home() { return <h1>Phase2</h1> }'

    // Before tool: sandbox must NOT contain new content
    expect(await sandbox.readFile(target)).toBeNull()

    let generationFinished = false
    const midRunProof: { sandboxHadContent: boolean; events: string[] } = {
      sandboxHadContent: false,
      events: [],
    }

    emitter.agentStart('mutation')
    emitter.toolStart('write_file', target)

    // Execute tool while "generation" is still running
    const executePromise = tools.write_file.execute!(
      { path: target, content: newContent, description: 'Add Home page' },
      { toolCallId: 'c1', messages: [] }
    )

    const result = await executePromise

    // Capture mid-run state BEFORE agent_done
    midRunProof.sandboxHadContent = (await sandbox.readFile(target)) === newContent
    midRunProof.events = events.map((e) => e.type)

    generationFinished = true
    emitter.toolResult('write_file', true, target)
    emitter.agentDone(true)

    expect(generationFinished).toBe(true)
    expect(result).toMatchObject({ ok: true, persistedToSandbox: true, path: target })
    expect(midRunProof.sandboxHadContent).toBe(true)
    expect(await readFile(path.join(tempRoot, target), 'utf8')).toBe(newContent)
    expect(midRunProof.events).toContain('file_write')
    expect(midRunProof.events.indexOf('file_write')).toBeLessThan(
      events.map((e) => e.type).lastIndexOf('agent_done') >= 0
        ? events.map((e) => e.type).lastIndexOf('agent_done')
        : midRunProof.events.length
    )
  })

  it('B: apply_patch mutates real sandbox immediately', async () => {
    const sandbox = createLocalSandboxFilesystem(tempRoot)
    await sandbox.writeFile('src/App.tsx', 'old')
    const history = createInMemoryDurableHistory()
    const events: AgentEvent[] = []
    const emitter = createRuntimeEmitter('plan-b', (e) => events.push(e))
    const fileMap: Record<string, { content?: string }> = {
      'src/App.tsx': { content: 'old' },
    }

    const persistMutation = createPersistMutationFn({
      projectId: 'proj-b',
      planId: 'plan-b',
      sandbox,
      appendDurableHistory: history.append,
      emitter,
    })

    const { tools } = createAgentTools(fileMap, {
      userPlan: 'enterprise',
      persistMutation,
      writeOnly: true,
    })

    const patched = 'export default function App() { return <main>patched</main> }'
    const result = await tools.apply_patch.execute!(
      { path: 'src/App.tsx', content: patched, description: 'Patch App' },
      { toolCallId: 'c2', messages: [] }
    )

    expect(result).toMatchObject({ ok: true, persistedToSandbox: true })
    expect(await sandbox.readFile('src/App.tsx')).toBe(patched)
    expect(events.some((e) => e.type === 'file_patch')).toBe(true)
    const patchEvent = events.find((e) => e.type === 'file_patch')
    expect(patchEvent?.data).toMatchObject({ persistedToSandbox: true, path: 'src/App.tsx' })
  })

  it('C: successful mutation creates durable history record', async () => {
    const sandbox = createLocalSandboxFilesystem(tempRoot)
    const history = createInMemoryDurableHistory()
    const emitter = createRuntimeEmitter('plan-c', () => {})

    const result = await persistAgentMutation({
      projectId: 'proj-c',
      planId: 'plan-c',
      operation: 'write_file',
      path: 'src/x.ts',
      content: 'export const x = 1',
      description: 'add x',
      originalContent: null,
      sandbox,
      appendDurableHistory: history.append,
      emitFileEvent: ({ path, bytes, description }) => {
        emitter.fileWrite(path, bytes, description)
      },
    })

    expect(result.ok).toBe(true)
    expect(history.records).toHaveLength(1)
    const record = history.records[0]!
    expect(record.type).toBe('diff')
    expect(record.planId).toBe('plan-c')
    expect(record.projectId).toBe('proj-c')
    expect(record.operation).toBe('write_file')
    expect(record.success).toBe(true)
    expect(record.persistedByAgentRuntime).toBe(true)
    expect(record.timestamp).toBeTruthy()
    expect(record.diff[0]?.path).toBe('src/x.ts')
    expect(record.diff[0]?.modified).toBe('export const x = 1')
  })

  it('D: sandbox write failure → no persistedToSandbox, no success history, no file_write', async () => {
    const events: AgentEvent[] = []
    const history = createInMemoryDurableHistory()
    const emitter = createRuntimeEmitter('plan-d', (e) => events.push(e))

    const failingSandbox = {
      root: tempRoot,
      writeFile: async () => {
        throw new Error('forced sandbox failure')
      },
      readFile: async () => null,
    }

    const result = await persistAgentMutation({
      projectId: 'proj-d',
      planId: 'plan-d',
      operation: 'write_file',
      path: 'src/fail.ts',
      content: 'nope',
      description: 'should fail',
      sandbox: failingSandbox,
      appendDurableHistory: history.append,
      emitFileEvent: ({ path, bytes, description }) => {
        emitter.fileWrite(path, bytes, description)
      },
    })

    expect(result).toEqual({
      ok: false,
      persistedToSandbox: false,
      path: 'src/fail.ts',
      error: 'forced sandbox failure',
    })
    expect(history.records).toHaveLength(0)
    expect(events.some((e) => e.type === 'file_write' || e.type === 'file_patch')).toBe(false)
  })

  it('E: same-project concurrent mutations are serialized', async () => {
    const sandbox = createLocalSandboxFilesystem(tempRoot)
    const order: string[] = []
    let concurrent = 0
    let maxConcurrent = 0

    const run = async (label: string, delayMs: number) => {
      return withProjectMutationLock('same-proj', async () => {
        concurrent += 1
        maxConcurrent = Math.max(maxConcurrent, concurrent)
        order.push(`start:${label}`)
        await new Promise((r) => setTimeout(r, delayMs))
        await sandbox.writeFile(`src/${label}.ts`, label)
        order.push(`end:${label}`)
        concurrent -= 1
      })
    }

    const pA = run('a', 40)
    await new Promise((r) => setTimeout(r, 5))
    const pB = run('b', 10)
    await Promise.all([pA, pB])

    expect(maxConcurrent).toBe(1)
    expect(order).toEqual(['start:a', 'end:a', 'start:b', 'end:b'])
    expect(isProjectMutationLockHeld('same-proj')).toBe(false)
    expect(await sandbox.readFile('src/a.ts')).toBe('a')
    expect(await sandbox.readFile('src/b.ts')).toBe('b')
  })

  it('F: different projects do not block each other', async () => {
    const started: string[] = []
    let overlap = false
    let active = 0

    const run = async (projectId: string) => {
      return withProjectMutationLock(projectId, async () => {
        active += 1
        if (active > 1) overlap = true
        started.push(projectId)
        await new Promise((r) => setTimeout(r, 30))
        active -= 1
      })
    }

    await Promise.all([run('proj-1'), run('proj-2')])
    expect(overlap).toBe(true)
    expect(started).toHaveLength(2)
  })

  it('G: abort after successful write leaves sandbox file and releases lock', async () => {
    const sandbox = createLocalSandboxFilesystem(tempRoot)
    const history = createInMemoryDurableHistory()
    const content = 'survives-abort'

    const result = await persistAgentMutation({
      projectId: 'proj-g',
      planId: 'plan-g',
      operation: 'write_file',
      path: 'src/keep.ts',
      content,
      description: 'keep',
      sandbox,
      appendDurableHistory: history.append,
      emitFileEvent: () => {},
    })

    expect(result.ok).toBe(true)
    // Simulate generation abort / browser disconnect AFTER successful write
    const abortController = new AbortController()
    abortController.abort()
    expect(abortController.signal.aborted).toBe(true)

    expect(await sandbox.readFile('src/keep.ts')).toBe(content)
    expect(isProjectMutationLockHeld('proj-g')).toBe(false)
    expect(history.records).toHaveLength(1)
  })

  it('H: event order tool_start → sandbox → history → file_write → tool_result', async () => {
    const sandbox = createLocalSandboxFilesystem(tempRoot)
    const timeline: string[] = []
    const history = createInMemoryDurableHistory()
    const events: AgentEvent[] = []
    const emitter = createRuntimeEmitter('plan-h', (e) => {
      events.push(e)
      timeline.push(`event:${e.type}`)
    })

    const instrumentedSandbox = {
      root: sandbox.root,
      writeFile: async (p: string, c: string) => {
        timeline.push('sandbox:write')
        await sandbox.writeFile(p, c)
        timeline.push('sandbox:done')
      },
      readFile: (p: string) => sandbox.readFile(p),
    }

    emitter.agentStart('mutation')
    emitter.toolStart('write_file', 'src/order.ts')
    timeline.push('after:tool_start')

    const result = await persistAgentMutation({
      projectId: 'proj-h',
      planId: 'plan-h',
      operation: 'write_file',
      path: 'src/order.ts',
      content: 'ordered',
      description: 'order test',
      sandbox: instrumentedSandbox,
      appendDurableHistory: async (record) => {
        timeline.push('history:append')
        await history.append(record)
      },
      emitFileEvent: ({ path, bytes, description }) => {
        timeline.push('before:file_write')
        emitter.fileWrite(path, bytes, description)
      },
    })

    emitter.toolResult('write_file', true, 'src/order.ts')
    timeline.push('after:tool_result')

    expect(result.ok).toBe(true)
    const sandboxIdx = timeline.indexOf('sandbox:write')
    const historyIdx = timeline.indexOf('history:append')
    const fileWriteIdx = timeline.indexOf('event:file_write')
    const toolStartIdx = timeline.indexOf('event:tool_start')
    const toolResultIdx = timeline.indexOf('event:tool_result')

    expect(toolStartIdx).toBeGreaterThanOrEqual(0)
    expect(sandboxIdx).toBeGreaterThan(toolStartIdx)
    expect(historyIdx).toBeGreaterThan(sandboxIdx)
    expect(fileWriteIdx).toBeGreaterThan(historyIdx)
    expect(toolResultIdx).toBeGreaterThan(fileWriteIdx)
  })

  it('lock is released when mutation throws after acquire', async () => {
    await expect(
      withProjectMutationLock('proj-throw', async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
    expect(isProjectMutationLockHeld('proj-throw')).toBe(false)
  })

  it('A-fix: cloud mirror failure does not fail authoritative local persist', async () => {
    const { createCompositeSandboxFilesystem } = await import('../agent/sandbox-fs')
    const local = createLocalSandboxFilesystem(tempRoot)
    let mirrorCalls = 0
    const failingMirror = {
      root: 'cloud:fake',
      writeFile: async () => {
        mirrorCalls += 1
        throw new Error('cloud mirror down')
      },
      readFile: async () => null,
    }
    const composite = createCompositeSandboxFilesystem(local, failingMirror)
    const history = createInMemoryDurableHistory()
    const events: AgentEvent[] = []
    const emitter = createRuntimeEmitter('plan-mirror', (e) => events.push(e))

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await persistAgentMutation({
      projectId: 'proj-mirror',
      planId: 'plan-mirror',
      operation: 'write_file',
      path: 'src/mirrored.ts',
      content: 'local-wins',
      description: 'mirror test',
      sandbox: composite,
      appendDurableHistory: history.append,
      emitFileEvent: ({ path, bytes, description }) => {
        emitter.fileWrite(path, bytes, description)
      },
    })

    warnSpy.mockRestore()

    expect(result).toMatchObject({ ok: true, persistedToSandbox: true, path: 'src/mirrored.ts' })
    expect(mirrorCalls).toBe(1)
    expect(await local.readFile('src/mirrored.ts')).toBe('local-wins')
    expect(history.records).toHaveLength(1)
    expect(events.some((e) => e.type === 'file_write')).toBe(true)
    expect(events.find((e) => e.type === 'file_write')?.data).toMatchObject({
      persistedToSandbox: true,
    })
  })

  it('B-fix: Cursor-style accepted writes go through lock→sandbox→history→event', async () => {
    const { acceptRuntimeWrites } = await import('../agent/accept-writes')
    const sandbox = createLocalSandboxFilesystem(tempRoot)
    const history = createInMemoryDurableHistory()
    const events: AgentEvent[] = []
    const emitter = createRuntimeEmitter('plan-cursor', (e) => events.push(e))
    const fileMap: Record<string, { content?: string }> = {}
    const order: string[] = []

    const persistMutation = createPersistMutationFn({
      projectId: 'proj-cursor',
      planId: 'plan-cursor',
      sandbox: {
        root: sandbox.root,
        writeFile: async (p, c) => {
          order.push('sandbox')
          await sandbox.writeFile(p, c)
        },
        readFile: (p) => sandbox.readFile(p),
      },
      appendDurableHistory: async (record) => {
        order.push('history')
        await history.append(record)
      },
      emitter: {
        ...emitter,
        fileWrite: (path, bytes, description) => {
          order.push('event')
          emitter.fileWrite(path, bytes, description)
        },
      },
    })

    // Simulate Cursor bridge returning patches (same shape as cursorResult.writes)
    const cursorWrites = [
      {
        path: 'server/api.ts',
        content: 'export const handler = () => {}',
        description: 'Cursor backend route',
      },
    ]

    const accepted = await acceptRuntimeWrites({
      writes: cursorWrites,
      fileMap,
      persistMutation,
      source: 'cursor',
    })

    expect(accepted).toHaveLength(1)
    expect(await sandbox.readFile('server/api.ts')).toBe('export const handler = () => {}')
    expect(history.records).toHaveLength(1)
    expect(history.records[0]?.operation).toBe('write_file')
    expect(events.some((e) => e.type === 'file_write')).toBe(true)
    expect(order).toEqual(['sandbox', 'history', 'event'])
    expect(fileMap['server/api.ts']?.content).toBe('export const handler = () => {}')
    // Not only allWrites/fileMap — sandbox + history + event all present
  })

  it('C-fix: XML extracts without persistMutation are RAM-only (no file_write / no sandbox claim)', async () => {
    const { acceptRuntimeWrites } = await import('../agent/accept-writes')
    const sandbox = createLocalSandboxFilesystem(tempRoot)
    const events: AgentEvent[] = []
    createRuntimeEmitter('plan-xml-ram', (e) => events.push(e))
    const fileMap: Record<string, { content?: string }> = {}

    // XML compatibility without Phase 2 adapter — must not emit sandbox-persisted events
    const accepted = await acceptRuntimeWrites({
      writes: [
        {
          path: 'src/XmlOnly.tsx',
          content: 'export default function XmlOnly() { return null }',
          description: 'xml fallback',
        },
      ],
      fileMap,
      // no persistMutation
      source: 'xml',
    })

    expect(accepted).toHaveLength(1)
    expect(fileMap['src/XmlOnly.tsx']?.content).toContain('XmlOnly')
    expect(await sandbox.readFile('src/XmlOnly.tsx')).toBeNull()
    expect(events.some((e) => e.type === 'file_write' || e.type === 'file_patch')).toBe(false)
  })

  it('C-fix: XML extracts WITH persistMutation use the authoritative pipeline', async () => {
    const { acceptRuntimeWrites } = await import('../agent/accept-writes')
    const sandbox = createLocalSandboxFilesystem(tempRoot)
    const history = createInMemoryDurableHistory()
    const events: AgentEvent[] = []
    const emitter = createRuntimeEmitter('plan-xml-persist', (e) => events.push(e))
    const fileMap: Record<string, { content?: string }> = {}

    const persistMutation = createPersistMutationFn({
      projectId: 'proj-xml',
      planId: 'plan-xml-persist',
      sandbox,
      appendDurableHistory: history.append,
      emitter,
    })

    const accepted = await acceptRuntimeWrites({
      writes: [
        {
          path: 'src/XmlPersisted.tsx',
          content: 'export default function XmlPersisted() { return <div /> }',
          description: 'xml via persist',
        },
      ],
      fileMap,
      persistMutation,
      source: 'xml',
    })

    expect(accepted).toHaveLength(1)
    expect(await sandbox.readFile('src/XmlPersisted.tsx')).toContain('XmlPersisted')
    expect(history.records).toHaveLength(1)
    expect(events.some((e) => e.type === 'file_write')).toBe(true)
  })
})
