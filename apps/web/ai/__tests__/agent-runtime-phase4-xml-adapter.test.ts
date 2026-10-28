/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * agent-runtime-phase4-xml-adapter.test.ts
 *
 * Phase 4: XML is a compatibility adapter only — one authoritative mutation writer.
 */

import { writeFile as fsWriteFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createInMemoryDurableHistory } from '../agent/in-memory-history'
import {
  isProjectMutationLockHeld,
  resetProjectMutationLocksForTests,
  withProjectMutationLock,
} from '../agent/project-mutation-lock'
import { AGENT_RUNTIME_CAPABILITIES } from '../agent/runtime-capabilities'
import { createRuntimeEmitter } from '../agent/runtime-emitter'
import type { AgentEvent } from '../agent/runtime-events'
import { createLocalSandboxFilesystem } from '../agent/sandbox-fs'
import { createPersistMutationFn } from '../agent/tools'
import { acceptXmlCompatibilityWrites, parseXmlCompatibilityWrites } from '../agent/xml-adapter'

const SAMPLE_XML = `<plan>
<thinking><![CDATA[Update the home page]]></thinking>
<planDescription><![CDATA[Write App]]></planDescription>
<action type="file">
<description><![CDATA[Home page]]></description>
<file filename="src/App.tsx"><![CDATA[export default function App(){ return <main>xml-adapter</main> }]]></file>
</action>
</plan>`

describe('Phase 4: XML compatibility adapter (single writer)', () => {
  let tempRoot: string

  beforeEach(async () => {
    resetProjectMutationLocksForTests()
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'quickxbuild-p4-xml-'))
    await mkdir(path.join(tempRoot, 'src'), { recursive: true })
    await fsWriteFile(
      path.join(tempRoot, 'package.json'),
      JSON.stringify({ name: 'demo', scripts: { build: 'vite build' } }),
      'utf8'
    )
  })

  afterEach(async () => {
    resetProjectMutationLocksForTests()
    await rm(tempRoot, { recursive: true, force: true })
  })

  it('H: capability matrix — xmlAdapterOnly true; Phase 6+/RAG false', () => {
    expect(AGENT_RUNTIME_CAPABILITIES.xmlAdapterOnly).toBe(true)
    expect(AGENT_RUNTIME_CAPABILITIES.failClosedSmoke).toBe(false)
    expect(AGENT_RUNTIME_CAPABILITIES.e2eAcceptance).toBe(false)
    expect(AGENT_RUNTIME_CAPABILITIES.ragEnabled).toBe(false)
    expect(AGENT_RUNTIME_CAPABILITIES.installBuildRepair).toBe(true)
    expect(AGENT_RUNTIME_CAPABILITIES.successGateEnforced).toBe(true)
  })

  it('A: XML adapter parses action type=file into AgentWrite[] without writing disk', async () => {
    const sandbox = createLocalSandboxFilesystem(tempRoot)
    const before = await sandbox.readFile('src/App.tsx')
    expect(before).toBeNull()

    const writes = parseXmlCompatibilityWrites(SAMPLE_XML)
    expect(writes).toHaveLength(1)
    expect(writes[0]?.path).toBe('src/App.tsx')
    expect(writes[0]?.content).toContain('xml-adapter')

    // Adapter itself did not mutate sandbox
    expect(await sandbox.readFile('src/App.tsx')).toBeNull()
  })

  it('B: XML → acceptRuntimeWrites → persistMutation → sandbox + history + file_write', async () => {
    const sandbox = createLocalSandboxFilesystem(tempRoot)
    const history = createInMemoryDurableHistory()
    const events: AgentEvent[] = []
    const emitter = createRuntimeEmitter('p4-b', (e) => events.push(e))
    const fileMap: Record<string, { content?: string }> = {}
    const writes = parseXmlCompatibilityWrites(SAMPLE_XML)

    const persistMutation = createPersistMutationFn({
      projectId: 'p4-b',
      planId: 'p4-b',
      sandbox,
      appendDurableHistory: history.append,
      emitter,
      alreadyLocked: true,
    })

    const accepted = await withProjectMutationLock('p4-b', () =>
      acceptXmlCompatibilityWrites({
        writes,
        fileMap,
        persistMutation,
      })
    )

    expect(accepted).toHaveLength(1)
    expect(await sandbox.readFile('src/App.tsx')).toContain('xml-adapter')
    expect(history.records).toHaveLength(1)
    expect(history.records[0]?.persistedByAgentRuntime).toBe(true)
    expect(events.some((e) => e.type === 'file_write')).toBe(true)
    const fw = events.find((e) => e.type === 'file_write') as {
      data?: { persistedToSandbox?: boolean }
    }
    expect(fw?.data?.persistedToSandbox).toBe(true)
  })

  it('C: XML without persistMutation does not claim sandbox persistence', async () => {
    const sandbox = createLocalSandboxFilesystem(tempRoot)
    const events: AgentEvent[] = []
    createRuntimeEmitter('p4-c', (e) => events.push(e))
    const fileMap: Record<string, { content?: string }> = {}
    const writes = parseXmlCompatibilityWrites(SAMPLE_XML)

    const accepted = await acceptXmlCompatibilityWrites({
      writes,
      fileMap,
      // no persistMutation
    })

    expect(accepted).toHaveLength(1)
    expect(fileMap['src/App.tsx']?.content).toContain('xml-adapter')
    expect(await sandbox.readFile('src/App.tsx')).toBeNull()
    expect(events.some((e) => e.type === 'file_write' || e.type === 'file_patch')).toBe(false)
  })

  it('D: one XML mutation → exactly one durable history record', async () => {
    const sandbox = createLocalSandboxFilesystem(tempRoot)
    const history = createInMemoryDurableHistory()
    const events: AgentEvent[] = []
    const emitter = createRuntimeEmitter('p4-d', (e) => events.push(e))
    const fileMap: Record<string, { content?: string }> = {}
    const writes = parseXmlCompatibilityWrites(SAMPLE_XML)

    await withProjectMutationLock('p4-d', async () => {
      const persistMutation = createPersistMutationFn({
        projectId: 'p4-d',
        planId: 'p4-d',
        sandbox,
        appendDurableHistory: history.append,
        emitter,
        alreadyLocked: true,
      })
      await acceptXmlCompatibilityWrites({ writes, fileMap, persistMutation })
    })

    // Simulate route finalization: must skip when already persisted by Agent Runtime
    const persistedByAgentRuntime = true
    if (!persistedByAgentRuntime) {
      history.records.push({
        type: 'diff',
        planId: 'p4-d',
        contentType: 'files',
        diff: [],
      } as never)
    }

    expect(history.records).toHaveLength(1)
    expect(isProjectMutationLockHeld('p4-d')).toBe(false)
  })

  it('E: no duplicate deployment — client skips deploy when file_write persistedToSandbox', async () => {
    // Mirrors ai-response-processor: runtimeSandboxPersisted from file_write events
    const events: AgentEvent[] = []
    let runtimeSandboxPersisted = false
    let deployCount = 0
    const deployChanges = async () => {
      deployCount += 1
    }

    const sandbox = createLocalSandboxFilesystem(tempRoot)
    const history = createInMemoryDurableHistory()
    const emitter = createRuntimeEmitter('p4-e', (e) => {
      events.push(e)
      if (
        (e.type === 'file_write' || e.type === 'file_patch') &&
        (e as { data?: { persistedToSandbox?: boolean } }).data?.persistedToSandbox === true
      ) {
        runtimeSandboxPersisted = true
      }
    })
    const fileMap: Record<string, { content?: string }> = {}

    await withProjectMutationLock('p4-e', async () => {
      const persistMutation = createPersistMutationFn({
        projectId: 'p4-e',
        planId: 'p4-e',
        sandbox,
        appendDurableHistory: history.append,
        emitter,
        alreadyLocked: true,
      })
      await acceptXmlCompatibilityWrites({
        writes: parseXmlCompatibilityWrites(SAMPLE_XML),
        fileMap,
        persistMutation,
      })
    })

    expect(runtimeSandboxPersisted).toBe(true)
    // Compatibility UI notify without second writer
    if (!runtimeSandboxPersisted) {
      await deployChanges()
    }
    expect(deployCount).toBe(0)
    expect(await sandbox.readFile('src/App.tsx')).toContain('xml-adapter')
  })

  it('parseXmlCompatibilityWrites ignores non-file actions', () => {
    const writes = parseXmlCompatibilityWrites(`
      <plan>
        <action type="command"><command>npm install lodash</command></action>
        <action type="file"><file filename="src/x.ts"><![CDATA[export const x = 1]]></file></action>
      </plan>
    `)
    expect(writes).toHaveLength(1)
    expect(writes[0]?.path).toBe('src/x.ts')
  })
})
