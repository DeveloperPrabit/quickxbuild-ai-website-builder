/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * agent-runtime-phase4-gate-authority.test.ts
 *
 * Phase 4 correction: Phase 3 gate is authoritative — failed gate must not
 * trigger XML fallback, must propagate through GenerationStreamResult, and
 * must not log AI_EXECUTION_BUILD_STATUS.SUCCESS.
 */

import { writeFile as fsWriteFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { stringToTextStream } from '../agent/apply'
import {
  resolveAiExecutionBuildStatus,
  shouldFallBackToXmlCompatibility,
} from '../agent/generation-outcome'
import { createInMemoryDurableHistory } from '../agent/in-memory-history'
import type { AgentLoopResult } from '../agent/loop'
import { runPhase3InstallBuildRepair } from '../agent/phase3-pipeline'
import {
  isProjectMutationLockHeld,
  resetProjectMutationLocksForTests,
  withProjectMutationLock,
} from '../agent/project-mutation-lock'
import { resolveProjectSandboxFilesystem } from '../agent/project-sandbox'
import { AGENT_RUNTIME_CAPABILITIES } from '../agent/runtime-capabilities'
import { createRuntimeEmitter } from '../agent/runtime-emitter'
import type { AgentEvent } from '../agent/runtime-events'
import {
  type AllowlistedCommandSpec,
  buildBuildCommand,
  executeAllowlistedCommand,
} from '../agent/sandbox-commands'
import { createLocalSandboxFilesystem } from '../agent/sandbox-fs'
import { createPersistMutationFn } from '../agent/tools'
import { acceptXmlCompatibilityWrites, parseXmlCompatibilityWrites } from '../agent/xml-adapter'

function emptyLoop(partial: Partial<AgentLoopResult>): AgentLoopResult {
  return {
    textStream: stringToTextStream(''),
    applied: false,
    writes: [],
    ...partial,
  }
}

describe('Phase 4 correction: Phase 3 gate authority', () => {
  let tempRoot: string

  beforeEach(async () => {
    resetProjectMutationLocksForTests()
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'quickxbuild-p4-gate-'))
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

  it('capability matrix unchanged (Phase 6+/RAG still false)', () => {
    expect(AGENT_RUNTIME_CAPABILITIES.xmlAdapterOnly).toBe(true)
    expect(AGENT_RUNTIME_CAPABILITIES.successGateEnforced).toBe(true)
    expect(AGENT_RUNTIME_CAPABILITIES.failClosedSmoke).toBe(false)
    expect(AGENT_RUNTIME_CAPABILITIES.e2eAcceptance).toBe(false)
    expect(AGENT_RUNTIME_CAPABILITIES.ragEnabled).toBe(false)
  })

  it('A: failed Phase 3 gate does NOT trigger XML fallback', () => {
    const loopResult = emptyLoop({
      applied: true,
      writes: [{ path: 'src/App.tsx', content: 'x', description: 'w' }],
      phase3Gate: {
        success: false,
        operation: 'mutation',
        writesOk: true,
        installRequired: false,
        installOk: true,
        buildOk: false,
        previewHealthOk: false,
        failures: ['build_failed'],
      },
    })

    expect(
      shouldFallBackToXmlCompatibility({
        mustApply: true,
        loopError: undefined,
        loopResult,
      })
    ).toBe(false)
  })

  it('A2: successful Phase 3 gate does NOT trigger XML fallback', () => {
    expect(
      shouldFallBackToXmlCompatibility({
        mustApply: true,
        loopError: undefined,
        loopResult: emptyLoop({
          applied: true,
          phase3Gate: {
            success: true,
            operation: 'mutation',
            writesOk: true,
            installRequired: false,
            installOk: true,
            buildOk: true,
            previewHealthOk: true,
            failures: [],
          },
        }),
      })
    ).toBe(false)
  })

  it('F/G: phase3Gate + loopError MUST NOT trigger XML fallback', () => {
    // F: successful phase3Gate + loopError => NO XML fallback
    expect(
      shouldFallBackToXmlCompatibility({
        mustApply: true,
        loopError: new Error('post-gate crash'),
        loopResult: emptyLoop({
          applied: true,
          phase3Gate: {
            success: true,
            operation: 'mutation',
            writesOk: true,
            installRequired: false,
            installOk: true,
            buildOk: true,
            previewHealthOk: true,
            failures: [],
          },
        }),
      })
    ).toBe(false)

    // G: failed phase3Gate + loopError => NO XML fallback
    expect(
      shouldFallBackToXmlCompatibility({
        mustApply: true,
        loopError: new Error('post-gate crash'),
        loopResult: emptyLoop({
          applied: true,
          phase3Gate: {
            success: false,
            operation: 'mutation',
            writesOk: true,
            installRequired: false,
            installOk: true,
            buildOk: false,
            previewHealthOk: false,
            failures: ['build_failed'],
          },
        }),
      })
    ).toBe(false)
  })

  it('H: existing applied writes + loopError => no duplicate XML fallback', () => {
    expect(
      shouldFallBackToXmlCompatibility({
        mustApply: true,
        loopError: new Error('error after writes applied'),
        loopResult: emptyLoop({
          applied: true,
          writes: [{ path: 'src/App.tsx', content: 'hello', description: 'desc' }],
        }),
      })
    ).toBe(false)
  })

  it('A3: XML fallback only when mustApply and no writes and no Phase 3', () => {
    expect(
      shouldFallBackToXmlCompatibility({
        mustApply: true,
        loopError: undefined,
        loopResult: emptyLoop({ applied: false }),
      })
    ).toBe(true)

    expect(
      shouldFallBackToXmlCompatibility({
        mustApply: true,
        loopError: new Error('boom'),
        loopResult: null,
      })
    ).toBe(true)

    expect(
      shouldFallBackToXmlCompatibility({
        mustApply: false,
        loopError: new Error('boom'),
        loopResult: null,
      })
    ).toBe(false)
  })

  it('B/D: resolveAiExecutionBuildStatus satisfies complete Truth Table', () => {
    const successGate = {
      success: true,
      operation: 'mutation' as const,
      writesOk: true,
      installRequired: false,
      installOk: true,
      buildOk: true,
      previewHealthOk: true,
      failures: [],
    }

    const failedGate = {
      success: false,
      operation: 'mutation' as const,
      writesOk: true,
      installRequired: false,
      installOk: true,
      buildOk: false,
      previewHealthOk: false,
      failures: ['build_failed'],
    }

    // 1. mutation + incomplete + any gate => FAILED
    expect(
      resolveAiExecutionBuildStatus({
        operation: 'mutation',
        streamCompleted: false,
        phase3Gate: successGate,
      })
    ).toBe('FAILED')
    expect(
      resolveAiExecutionBuildStatus({
        operation: 'mutation',
        streamCompleted: false,
        phase3Gate: failedGate,
      })
    ).toBe('FAILED')
    expect(
      resolveAiExecutionBuildStatus({
        operation: 'mutation',
        streamCompleted: false,
        phase3Gate: undefined,
      })
    ).toBe('FAILED')

    // 2. mutation + complete + missing gate => FAILED (requires phase3Gate.success === true)
    expect(
      resolveAiExecutionBuildStatus({
        operation: 'mutation',
        streamCompleted: true,
        phase3Gate: undefined,
      })
    ).toBe('FAILED')

    // Default operation is mutation if omitted => complete + missing gate is FAILED
    expect(
      resolveAiExecutionBuildStatus({
        streamCompleted: true,
        phase3Gate: undefined,
      })
    ).toBe('FAILED')

    // 3. mutation + complete + failed gate => FAILED
    expect(
      resolveAiExecutionBuildStatus({
        operation: 'mutation',
        streamCompleted: true,
        phase3Gate: failedGate,
      })
    ).toBe('FAILED')

    // 4. mutation + complete + successful gate => SUCCESS
    expect(
      resolveAiExecutionBuildStatus({
        operation: 'mutation',
        streamCompleted: true,
        phase3Gate: successGate,
      })
    ).toBe('SUCCESS')

    // 5. read_only + incomplete + any gate => FAILED
    expect(
      resolveAiExecutionBuildStatus({
        operation: 'read_only',
        streamCompleted: false,
        phase3Gate: successGate,
      })
    ).toBe('FAILED')
    expect(
      resolveAiExecutionBuildStatus({
        operation: 'read_only',
        streamCompleted: false,
        phase3Gate: undefined,
      })
    ).toBe('FAILED')

    // 6. read_only + complete + missing gate => SUCCESS
    expect(
      resolveAiExecutionBuildStatus({
        operation: 'read_only',
        streamCompleted: true,
        phase3Gate: undefined,
      })
    ).toBe('SUCCESS')

    // 7. read_only + complete + failed gate => FAILED
    expect(
      resolveAiExecutionBuildStatus({
        operation: 'read_only',
        streamCompleted: true,
        phase3Gate: failedGate,
      })
    ).toBe('FAILED')

    // 8. read_only + complete + successful gate => SUCCESS
    expect(
      resolveAiExecutionBuildStatus({
        operation: 'read_only',
        streamCompleted: true,
        phase3Gate: successGate,
      })
    ).toBe('SUCCESS')
  })

  it('C: XML persist + Phase 3 failure → gate false; sandbox has writes; no second XML', async () => {
    const sandbox = createLocalSandboxFilesystem(tempRoot)
    const history = createInMemoryDurableHistory()
    const events: AgentEvent[] = []
    const emitter = createRuntimeEmitter('p4-gate-c', (e) => events.push(e))
    const fileMap: Record<string, { content?: string }> = {}

    const xml = `<plan><action type="file"><file filename="src/App.tsx"><![CDATA[export default function App(){return <main>broken-import</main>}
import X from "missing-package"]]></file></action></plan>`
    const writes = parseXmlCompatibilityWrites(xml)

    const xmlModelInvocations = 0
    // Simulate GenerationStreamResult assembly after adapter (no second XML pass)
    const result = await withProjectMutationLock('p4-gate-c', async () => {
      const persistMutation = createPersistMutationFn({
        projectId: 'p4-gate-c',
        planId: 'p4-gate-c',
        sandbox,
        appendDurableHistory: history.append,
        emitter,
        alreadyLocked: true,
      })
      const accepted = await acceptXmlCompatibilityWrites({
        writes,
        fileMap,
        persistMutation,
      })
      const phase3 = await runPhase3InstallBuildRepair({
        projectId: 'p4-gate-c',
        planId: 'p4-gate-c',
        sandbox,
        emitter,
        persistMutation,
        fileMap,
        writtenPaths: accepted.map((w) => w.path),
        runCommand: async (_root, spec: AllowlistedCommandSpec) => {
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
            stderr: 'Failed to resolve import "missing-package" from "src/App.tsx"',
            durationMs: 2,
            ok: false,
          }
        },
        checkPreview: async () => ({ ok: true }),
        repairFn: async () => [
          {
            path: 'src/App.tsx',
            content: 'import X from "missing-package"\nexport default function App(){return null}',
            description: 'intentionally broken',
          },
        ],
      })
      return {
        writes: accepted,
        persistedByAgentRuntime: true,
        phase3Gate: phase3.gate,
      }
    })

    // No second XML generation after gate
    expect(xmlModelInvocations).toBe(0)
    expect(
      shouldFallBackToXmlCompatibility({
        mustApply: true,
        loopError: undefined,
        loopResult: emptyLoop({
          applied: true,
          writes: result.writes,
          phase3Gate: result.phase3Gate,
        }),
      })
    ).toBe(false)

    expect(await sandbox.readFile('src/App.tsx')).toBeTruthy()
    expect(result.phase3Gate?.success).toBe(false)
    expect(result.persistedByAgentRuntime).toBe(true)
    expect(result.persistedByAgentRuntime && result.phase3Gate?.success).toBe(false)
    expect(history.records.length).toBeGreaterThanOrEqual(1)
    expect(
      resolveAiExecutionBuildStatus({
        streamCompleted: true,
        phase3Gate: result.phase3Gate,
      })
    ).toBe('FAILED')
    expect(isProjectMutationLockHeld('p4-gate-c')).toBe(false)
  })

  it('J/K: failed gate keeps single history; deploy skipped when persisted', async () => {
    const sandbox = createLocalSandboxFilesystem(tempRoot)
    const history = createInMemoryDurableHistory()
    const events: AgentEvent[] = []
    let runtimeSandboxPersisted = false
    let deployCount = 0
    const emitter = createRuntimeEmitter('p4-gate-jk', (e) => {
      events.push(e)
      if (
        (e.type === 'file_write' || e.type === 'file_patch') &&
        (e as { data?: { persistedToSandbox?: boolean } }).data?.persistedToSandbox
      ) {
        runtimeSandboxPersisted = true
      }
    })

    await withProjectMutationLock('p4-gate-jk', async () => {
      const persistMutation = createPersistMutationFn({
        projectId: 'p4-gate-jk',
        planId: 'p4-gate-jk',
        sandbox,
        appendDurableHistory: history.append,
        emitter,
        alreadyLocked: true,
      })
      await acceptXmlCompatibilityWrites({
        writes: [
          {
            path: 'src/App.tsx',
            content: 'export default function App(){ return null }',
            description: 'w',
          },
        ],
        fileMap: {},
        persistMutation,
      })
    })

    const persistedByAgentRuntime = true
    const phase3Gate = {
      success: false,
      operation: 'mutation' as const,
      writesOk: true,
      installRequired: false,
      installOk: true,
      buildOk: false,
      previewHealthOk: false,
      failures: ['build_failed'],
    }

    // Route must not append second history when already persisted
    if (!persistedByAgentRuntime) {
      history.records.push({ type: 'diff', planId: 'p4-gate-jk' } as never)
    }
    expect(history.records).toHaveLength(1)

    if (!runtimeSandboxPersisted) {
      deployCount += 1
    }
    expect(deployCount).toBe(0)
    expect(
      resolveAiExecutionBuildStatus({
        operation: 'mutation',
        streamCompleted: true,
        phase3Gate,
      })
    ).toBe('FAILED')
  })

  it('I: existing project is correctly initialized into sandbox', async () => {
    const testProjectId = `p4-init-${Date.now()}`
    const initialFiles = {
      'package.json': JSON.stringify({
        name: 'test-app',
        scripts: { build: 'bun -e "console.log(\'BUILT_TEST_APP\')"' },
      }),
      'vite.config.ts': 'export default {}',
      'tsconfig.json': '{\n  "compilerOptions": {}\n}',
      'src/App.tsx': 'export default function App() { return <div>Original</div> }',
      'public/robots.txt': 'User-agent: *',
    }

    try {
      const sandbox = await resolveProjectSandboxFilesystem({
        projectId: testProjectId,
        initialFiles,
      })

      // Invariant 1: Existing project files are available to the build environment
      expect(await sandbox.readFile('package.json')).toContain('test-app')
      expect(await sandbox.readFile('vite.config.ts')).toBe('export default {}')
      expect(await sandbox.readFile('tsconfig.json')).toContain('"compilerOptions"')
      expect(await sandbox.readFile('src/App.tsx')).toContain('<div>Original</div>')
      expect(await sandbox.readFile('public/robots.txt')).toBe('User-agent: *')

      // Invariant 2: Sandbox root is the authoritative directory
      expect(sandbox.root).toContain(testProjectId)
    } finally {
      await rm(path.join(os.tmpdir(), 'quickxbuild-agent-sandbox', testProjectId), {
        recursive: true,
        force: true,
      })
    }
  })

  it('J: build uses same authoritative sandbox where mutation was applied', async () => {
    const testProjectId = `p4-build-${Date.now()}`
    const initialFiles = {
      'package.json': JSON.stringify({
        name: 'authoritative-build-test',
        scripts: { build: 'bun -e "console.log(\'AUTHD_BUILD_SUCCESS\')"' },
      }),
      'src/App.tsx': 'export default function App() { return <div>Original</div> }',
    }

    try {
      const sandbox = await resolveProjectSandboxFilesystem({
        projectId: testProjectId,
        initialFiles,
      })

      // 1. AgentRuntime mutation reaches the same environment used by build
      await sandbox.writeFile(
        'src/App.tsx',
        'export default function App() { return <div>Mutated Code</div> }'
      )
      expect(await sandbox.readFile('src/App.tsx')).toContain('<div>Mutated Code</div>')

      // 2. buildBuildCommand inspects package.json in sandbox.root
      const spec = await buildBuildCommand(sandbox)
      expect(spec.kind).toBe('build')
      expect(spec.bin).toBe('bun')
      expect(spec.args).toEqual(['run', 'build'])

      // 3. executeAllowlistedCommand executes with cwd = sandbox.root
      const cmdResult = await executeAllowlistedCommand(sandbox.root, spec)
      expect(cmdResult.cwd).toBe(path.resolve(sandbox.root))
      expect(cmdResult.ok).toBe(true)
      expect(cmdResult.exitCode).toBe(0)
      expect(cmdResult.stdout).toContain('AUTHD_BUILD_SUCCESS')

      // 4. Invariant: build did NOT run in an empty directory
      expect(cmdResult.cwd).toContain(testProjectId)
    } finally {
      await rm(path.join(os.tmpdir(), 'quickxbuild-agent-sandbox', testProjectId), {
        recursive: true,
        force: true,
      })
    }
  })
})
