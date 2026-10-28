/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * agent-runtime-phase3-integration.test.ts
 *
 * Phase 3 correction acceptance: REAL production path through runAgentLoop →
 * streamText tools (including Phase 3 commands) → sandbox persist → build fail →
 * SAME runtime repair (streamText again with diagnostic) → persist → rebuild →
 * preview health → success gate.
 *
 * Does NOT use runPhase3InstallBuildRepair({ repairFn }) as primary proof.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const BAD =
  'import MissingThing from "missing-package"\nexport default function App(){ return <main>broken</main> }'
const FIXED = 'export default function App(){ return <main>fixed</main> }'

type StreamPart = Record<string, unknown>
type ToolMap = Record<string, { execute?: (input: unknown, opts: unknown) => Promise<unknown> }>

/** Hold-open async iterable so tool execute can push parts while consumer iterates (sync streamText). */
function createHoldOpenStream() {
  const queue: StreamPart[] = []
  let closed = false
  let wake: (() => void) | null = null

  const signal = () => {
    wake?.()
    wake = null
  }

  return {
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
        if (queue.length === 0 && closed) return
        yield queue.shift() as StreamPart
      }
    },
  }
}

let streamTextCalls: Array<{ prompt: string; tools: ToolMap }> = []
let buildFailOnce = true
/** When true, repair pass keeps writing BAD (failure-budget test). */
let repairKeepBroken = false

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()
  return {
    ...actual,
    // MUST be sync like real AI SDK streamText — async mock breaks result.fullStream.
    streamText: vi.fn((opts: { prompt: string; tools: ToolMap; system?: string }) => {
      const tools = (opts.tools || {}) as ToolMap
      const prompt = String(opts.prompt || '')
      streamTextCalls.push({ prompt, tools })

      const stream = createHoldOpenStream()
      const isRepair = prompt.includes('BUILD FAILED') || prompt.includes('<diagnostic>')

      void (async () => {
        try {
          const content = isRepair && !repairKeepBroken ? FIXED : BAD
          const description =
            isRepair && !repairKeepBroken
              ? 'Remove missing-package import'
              : isRepair
                ? 'intentionally broken repair'
                : 'Initial broken app'

          if (tools.write_file?.execute) {
            stream.push({ type: 'tool-input-start', id: 'w1', toolName: 'write_file' })
            stream.push({
              type: 'tool-call',
              toolCallId: 'w1',
              toolName: 'write_file',
              input: { path: 'src/App.tsx', content, description },
            })
            const out = await tools.write_file.execute(
              { path: 'src/App.tsx', content, description },
              { toolCallId: 'w1', messages: [] }
            )
            stream.push({
              type: 'tool-result',
              toolCallId: 'w1',
              toolName: 'write_file',
              input: { path: 'src/App.tsx' },
              output: out,
            })
          }
        } finally {
          stream.push({ type: 'finish' })
          stream.close()
        }
      })()

      return {
        fullStream: stream,
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

import { createInMemoryDurableHistory } from '../agent/in-memory-history'
import { runAgentLoop } from '../agent/loop'
import {
  isProjectMutationLockHeld,
  resetProjectMutationLocksForTests,
} from '../agent/project-mutation-lock'
import { AGENT_RUNTIME_CAPABILITIES } from '../agent/runtime-capabilities'
import type { AgentEvent } from '../agent/runtime-events'
import type { AllowlistedCommandSpec } from '../agent/sandbox-commands'
import { createLocalSandboxFilesystem } from '../agent/sandbox-fs'
import { createAgentTools } from '../agent/tools'

describe('Phase 3 same-AgentRuntime integration (runAgentLoop path)', () => {
  let tempRoot: string

  beforeEach(async () => {
    resetProjectMutationLocksForTests()
    streamTextCalls = []
    buildFailOnce = true
    repairKeepBroken = false
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'quickxbuild-p3-int-'))
    await mkdir(path.join(tempRoot, 'src'), { recursive: true })
    await writeFile(
      path.join(tempRoot, 'package.json'),
      JSON.stringify({ name: 'demo', scripts: { build: 'vite build' } }),
      'utf8'
    )
  })

  afterEach(async () => {
    resetProjectMutationLocksForTests()
    await rm(tempRoot, { recursive: true, force: true })
  })

  it('wires Phase 3 command tools into createAgentTools when runSandboxCommand is provided', () => {
    const { tools } = createAgentTools(
      {},
      {
        userPlan: 'enterprise',
        runSandboxCommand: async () => ({
          command: 'bun',
          args: ['run', 'build'],
          cwd: tempRoot,
          exitCode: 0,
          stdout: '',
          stderr: '',
          durationMs: 1,
          ok: true,
        }),
      }
    )
    expect(tools).toHaveProperty('install_packages')
    expect(tools).toHaveProperty('execute_command')
    expect(tools).toHaveProperty('run_build')
    expect(tools).toHaveProperty('write_file')
  })

  it('DiagnosticSource contract excludes install/command', async () => {
    const { DiagnosticSource } = await import('../agent/runtime-events')
    expect(DiagnosticSource.options).toEqual([
      'vite-transform',
      'vite-hmr',
      'build',
      'preview-smoke',
    ])
  })

  it('runAgentLoop: write → build fail → SAME runtime repair tools → rebuild → preview → gate', async () => {
    const sandbox = createLocalSandboxFilesystem(tempRoot)
    const history = createInMemoryDurableHistory()
    const events: AgentEvent[] = []
    const planId = 'plan-p3-int'
    const projectId = 'proj-p3-int'

    const result = await runAgentLoop({
      prompt: 'Fix the app build — implement src/App.tsx',
      xmlFiles: '',
      fileMap: {},
      userPlan: 'enterprise',
      planId,
      projectId,
      sandbox,
      appendDurableHistory: history.append,
      onAgentEvent: (e) => events.push(e),
      phase3RunCommand: async (_root, spec: AllowlistedCommandSpec) => {
        if (spec.kind === 'install') {
          return {
            command: spec.bin,
            args: spec.args,
            cwd: tempRoot,
            exitCode: 0,
            stdout: 'installed',
            stderr: '',
            durationMs: 2,
            ok: true,
          }
        }
        // First build fails while bad import present; later succeeds
        const content = await sandbox.readFile('src/App.tsx')
        if (content?.includes('missing-package') && buildFailOnce) {
          buildFailOnce = false
          return {
            command: spec.bin,
            args: spec.args,
            cwd: tempRoot,
            exitCode: 1,
            stdout: '',
            stderr: `Failed to resolve import "missing-package" from "src/App.tsx"`,
            durationMs: 3,
            ok: false,
          }
        }
        return {
          command: spec.bin,
          args: spec.args,
          cwd: tempRoot,
          exitCode: 0,
          stdout: 'built',
          stderr: '',
          durationMs: 3,
          ok: true,
        }
      },
      phase3CheckPreview: async () => {
        const content = await sandbox.readFile('src/App.tsx')
        if (!content || content.includes('missing-package')) {
          return { ok: false, reason: 'Preview serving broken sandbox' }
        }
        return { ok: true, url: 'http://127.0.0.1:5174/' }
      },
    })

    // Command tools were present on at least one streamText call (repair pass)
    const repairCall = streamTextCalls.find((c) => c.prompt.includes('BUILD FAILED'))
    expect(repairCall).toBeTruthy()
    expect(repairCall?.tools).toHaveProperty('write_file')
    expect(repairCall?.tools).toHaveProperty('install_packages')
    expect(repairCall?.tools).toHaveProperty('run_build')

    // Diagnostic reached the SAME runtime (in the repair prompt)
    expect(repairCall?.prompt).toContain('missing-package')
    expect(repairCall?.prompt).toContain('src/App.tsx')

    // Authoritative sandbox after completion
    expect(await sandbox.readFile('src/App.tsx')).toBe(FIXED)
    expect(await sandbox.readFile('src/App.tsx')).not.toContain('missing-package')

    // Durable history + events
    expect(history.records.length).toBeGreaterThanOrEqual(2)
    expect(events.some((e) => e.type === 'file_write')).toBe(true)
    expect(events.some((e) => e.type === 'diagnostic')).toBe(true)
    expect(events.some((e) => e.type === 'build_error' || e.type === 'build_success')).toBe(true)
    expect(events.some((e) => e.type === 'preview_status')).toBe(true)

    const done = events.filter((e) => e.type === 'agent_done').at(-1)
    expect(done).toBeTruthy()
    expect((done as { data?: { success?: boolean } }).data?.success).toBe(true)
    expect(result.phase3Gate?.success).toBe(true)
    expect(isProjectMutationLockHeld(projectId)).toBe(false)

    // Capability matrix: gym E2E flipped e2eAcceptance; failClosedSmoke still gated
    expect(AGENT_RUNTIME_CAPABILITIES.e2eAcceptance).toBe(true)
    expect(AGENT_RUNTIME_CAPABILITIES.failClosedSmoke).toBe(false)
    expect(AGENT_RUNTIME_CAPABILITIES.installBuildRepair).toBe(true)
  })

  it('runAgentLoop failure: bounded repair then agent_done.success=false and lock released', async () => {
    const sandbox = createLocalSandboxFilesystem(tempRoot)
    const history = createInMemoryDurableHistory()
    const events: AgentEvent[] = []
    const planId = 'plan-p3-fail'
    const projectId = 'proj-p3-fail'
    repairKeepBroken = true

    const result = await runAgentLoop({
      prompt: 'Implement src/App.tsx',
      xmlFiles: '',
      fileMap: {},
      userPlan: 'enterprise',
      planId,
      projectId,
      sandbox,
      appendDurableHistory: history.append,
      onAgentEvent: (e) => events.push(e),
      phase3RunCommand: async (_root, spec) => {
        if (spec.kind === 'install') {
          return {
            command: spec.bin,
            args: spec.args,
            cwd: tempRoot,
            exitCode: 0,
            stdout: '',
            stderr: '',
            durationMs: 1,
            ok: true,
          }
        }
        return {
          command: spec.bin,
          args: spec.args,
          cwd: tempRoot,
          exitCode: 1,
          stdout: '',
          stderr: `Failed to resolve import "missing-package" from "src/App.tsx"`,
          durationMs: 2,
          ok: false,
        }
      },
      phase3CheckPreview: async () => ({ ok: true }),
    })

    expect(result.phase3Gate?.success).toBe(false)
    const done = events.filter((e) => e.type === 'agent_done').at(-1)
    expect((done as { data?: { success?: boolean } })?.data?.success).toBe(false)
    expect(isProjectMutationLockHeld(projectId)).toBe(false)
  })
})
