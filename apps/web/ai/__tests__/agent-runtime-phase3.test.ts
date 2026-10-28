/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * agent-runtime-phase3.test.ts
 *
 * Phase 3: install → build → Vite diagnostics → same-runtime repair → preview gate.
 * Uses real sandbox FS + injectable command runners (not mocked gate booleans).
 */

import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLocalSandboxFilesystem } from '../agent/sandbox-fs'
import { createInMemoryDurableHistory } from '../agent/in-memory-history'
import { createPersistMutationFn } from '../agent/tools'
import { createRuntimeEmitter } from '../agent/runtime-emitter'
import {
  runPhase3InstallBuildRepair,
  MAX_BUILD_ATTEMPTS,
  MAX_REPAIR_ATTEMPTS,
} from '../agent/phase3-pipeline'
import {
  resolveAllowlistedCommand,
  dependenciesChanged,
  formatCommandLabel,
  type AllowlistedCommandSpec,
  type SandboxCommandResult,
} from '../agent/sandbox-commands'
import { normalizeViteDiagnostic, extractMissingPackage } from '../agent/vite-diagnostics'
import { checkPreviewHealth } from '../agent/preview-health'
import {
  isProjectMutationLockHeld,
  resetProjectMutationLocksForTests,
  withProjectMutationLock,
} from '../agent/project-mutation-lock'
import { AGENT_RUNTIME_CAPABILITIES } from '../agent/runtime-capabilities'
import { persistAgentMutation } from '../agent/persist-mutation'
import type { AgentEvent } from '../agent/runtime-events'

function okResult(spec: AllowlistedCommandSpec, ms = 5): SandboxCommandResult {
  return {
    command: spec.bin,
    args: spec.args,
    cwd: '/tmp',
    exitCode: 0,
    stdout: 'ok',
    stderr: '',
    durationMs: ms,
    ok: true,
  }
}

function failResult(
  spec: AllowlistedCommandSpec,
  stderr: string,
  ms = 5
): SandboxCommandResult {
  return {
    command: spec.bin,
    args: spec.args,
    cwd: '/tmp',
    exitCode: 1,
    stdout: '',
    stderr,
    durationMs: ms,
    ok: false,
  }
}

describe('Phase 3: install / build / diagnostics / repair / gate', () => {
  let tempRoot: string

  beforeEach(async () => {
    resetProjectMutationLocksForTests()
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'quickxbuild-phase3-'))
    await writeFile(
      path.join(tempRoot, 'package.json'),
      JSON.stringify({ name: 't', scripts: { build: 'vite build' } }),
      'utf8'
    )
  })

  afterEach(async () => {
    resetProjectMutationLocksForTests()
    await rm(tempRoot, { recursive: true, force: true })
  })

  it('capability matrix Phase 3–4 flags true; Phase 6+/RAG false', () => {
    expect(AGENT_RUNTIME_CAPABILITIES.installBuildRepair).toBe(true)
    expect(AGENT_RUNTIME_CAPABILITIES.viteDiagnostics).toBe(true)
    expect(AGENT_RUNTIME_CAPABILITIES.successGateEnforced).toBe(true)
    expect(AGENT_RUNTIME_CAPABILITIES.xmlAdapterOnly).toBe(true)
    expect(AGENT_RUNTIME_CAPABILITIES.failClosedSmoke).toBe(false)
    expect(AGENT_RUNTIME_CAPABILITIES.e2eAcceptance).toBe(false)
    expect(AGENT_RUNTIME_CAPABILITIES.ragEnabled).toBe(false)
  })

  it('A: install succeeds when dependencies changed', async () => {
    const sandbox = createLocalSandboxFilesystem(tempRoot)
    const history = createInMemoryDurableHistory()
    const events: AgentEvent[] = []
    const emitter = createRuntimeEmitter('p3-a', (e) => events.push(e))
    const persistMutation = createPersistMutationFn({
      projectId: 'p3-a',
      planId: 'p3-a',
      sandbox,
      appendDurableHistory: history.append,
      emitter,
      alreadyLocked: true,
    })

    expect(dependenciesChanged(['package.json'])).toBe(true)

    const result = await withProjectMutationLock('p3-a', () =>
      runPhase3InstallBuildRepair({
        projectId: 'p3-a',
        planId: 'p3-a',
        sandbox,
        emitter,
        persistMutation,
        fileMap: {},
        writtenPaths: ['package.json', 'src/App.tsx'],
        runCommand: async (_root, spec) => okResult(spec),
        checkPreview: async () => ({ ok: true, url: 'http://127.0.0.1:5174/' }),
      })
    )

    expect(result.installRequired).toBe(true)
    expect(result.installOk).toBe(true)
    expect(result.buildOk).toBe(true)
    expect(result.previewHealthOk).toBe(true)
    expect(result.gate.success).toBe(true)
    expect(events.some((e) => e.type === 'command_start')).toBe(true)
    expect(events.some((e) => e.type === 'build_success')).toBe(true)
  })

  it('B: install failure fails the success gate', async () => {
    const sandbox = createLocalSandboxFilesystem(tempRoot)
    const history = createInMemoryDurableHistory()
    const emitter = createRuntimeEmitter('p3-b', () => {})
    const persistMutation = createPersistMutationFn({
      projectId: 'p3-b',
      planId: 'p3-b',
      sandbox,
      appendDurableHistory: history.append,
      emitter,
      alreadyLocked: true,
    })

    const result = await withProjectMutationLock('p3-b', () =>
      runPhase3InstallBuildRepair({
        projectId: 'p3-b',
        planId: 'p3-b',
        sandbox,
        emitter,
        persistMutation,
        fileMap: {},
        writtenPaths: ['package.json'],
        runCommand: async (_root, spec) => {
          if (spec.kind === 'install') {
            return failResult(spec, 'npm ERR! network timeout')
          }
          return okResult(spec)
        },
        checkPreview: async () => ({ ok: true }),
      })
    )

    expect(result.installOk).toBe(false)
    expect(result.gate.success).toBe(false)
    expect(result.gate.failures).toContain('install_failed')
  })

  it('C: build success from real command result', async () => {
    const sandbox = createLocalSandboxFilesystem(tempRoot)
    const history = createInMemoryDurableHistory()
    const events: AgentEvent[] = []
    const emitter = createRuntimeEmitter('p3-c', (e) => events.push(e))
    const persistMutation = createPersistMutationFn({
      projectId: 'p3-c',
      planId: 'p3-c',
      sandbox,
      appendDurableHistory: history.append,
      emitter,
      alreadyLocked: true,
    })

    const result = await withProjectMutationLock('p3-c', () =>
      runPhase3InstallBuildRepair({
        projectId: 'p3-c',
        planId: 'p3-c',
        sandbox,
        emitter,
        persistMutation,
        fileMap: {},
        writtenPaths: ['src/App.tsx'],
        runCommand: async (_root, spec) => {
          expect(spec.kind).toBe('build')
          expect(formatCommandLabel(spec)).toMatch(/run build/)
          return okResult(spec)
        },
        checkPreview: async () => ({ ok: true, url: 'http://x/' }),
      })
    )

    expect(result.installRequired).toBe(false)
    expect(result.buildOk).toBe(true)
    expect(result.gate.success).toBe(true)
    expect(events.some((e) => e.type === 'build_success')).toBe(true)
  })

  it('D: build failure produces normalized diagnostic and gate failure', async () => {
    const sandbox = createLocalSandboxFilesystem(tempRoot)
    const history = createInMemoryDurableHistory()
    const events: AgentEvent[] = []
    const emitter = createRuntimeEmitter('p3-d', (e) => events.push(e))
    const persistMutation = createPersistMutationFn({
      projectId: 'p3-d',
      planId: 'p3-d',
      sandbox,
      appendDurableHistory: history.append,
      emitter,
      alreadyLocked: true,
    })

    const stderr = `error during build:
src/App.tsx:2:0: ERROR: Unexpected "import"
Failed to resolve import "package-that-does-not-exist" from "src/App.tsx"`

    const result = await withProjectMutationLock('p3-d', () =>
      runPhase3InstallBuildRepair({
        projectId: 'p3-d',
        planId: 'p3-d',
        sandbox,
        emitter,
        persistMutation,
        fileMap: {
          'src/App.tsx': {
            content: 'import X from "package-that-does-not-exist"\nexport default function App(){return null}',
          },
        },
        writtenPaths: ['src/App.tsx'],
        runCommand: async (_root, spec) => failResult(spec, stderr),
        // Exhaust repair by returning no writes
        repairFn: async () => [],
        checkPreview: async () => ({ ok: true }),
      })
    )

    expect(result.buildOk).toBe(false)
    expect(result.gate.success).toBe(false)
    expect(result.gate.failures).toContain('build_failed')
    expect(result.diagnostics.length).toBeGreaterThan(0)
    expect(events.some((e) => e.type === 'build_error')).toBe(true)
    expect(events.some((e) => e.type === 'diagnostic')).toBe(true)
  })

  it('E: Vite transform / module-resolution diagnostic normalization', () => {
    const diag = normalizeViteDiagnostic({
      stderr: `Failed to resolve import "lodash" from "src/pages/Home.tsx"`,
      source: 'vite-transform',
    })
    expect(diag).not.toBeNull()
    expect(diag!.message).toContain('lodash')
    expect(diag!.file).toBe('src/pages/Home.tsx')
    expect(diag!.source).toBe('vite-transform')
    expect(extractMissingPackage(diag!)).toBe('lodash')

    const syntax = normalizeViteDiagnostic({
      stderr: `src/App.tsx:10:5: ERROR: Expected "}" but found "return"`,
      source: 'build',
    })
    expect(syntax?.file).toBe('src/App.tsx')
    expect(syntax?.line).toBe(10)
    expect(syntax?.column).toBe(5)
  })

  it('F: same-AgentRuntime repair via persistMutation then rebuild + preview', async () => {
    const sandbox = createLocalSandboxFilesystem(tempRoot)
    await mkdir(path.join(tempRoot, 'src'), { recursive: true })
    const bad = 'import X from "package-that-does-not-exist"\nexport default function App(){ return <div/> }'
    const good = 'export default function App(){ return <div>fixed</div> }'
    await sandbox.writeFile('src/App.tsx', bad)

    const history = createInMemoryDurableHistory()
    const events: AgentEvent[] = []
    const emitter = createRuntimeEmitter('p3-f', (e) => events.push(e))
    const fileMap: Record<string, { content?: string }> = {
      'src/App.tsx': { content: bad },
    }
    const persistMutation = createPersistMutationFn({
      projectId: 'p3-f',
      planId: 'p3-f',
      sandbox,
      appendDurableHistory: history.append,
      emitter,
      alreadyLocked: true,
    })

    let builds = 0
    const result = await withProjectMutationLock('p3-f', () =>
      runPhase3InstallBuildRepair({
        projectId: 'p3-f',
        planId: 'p3-f',
        sandbox,
        emitter,
        persistMutation,
        fileMap,
        writtenPaths: ['src/App.tsx'],
        runCommand: async (_root, spec) => {
          if (spec.kind !== 'build') return okResult(spec)
          builds += 1
          const content = await sandbox.readFile('src/App.tsx')
          if (content?.includes('package-that-does-not-exist')) {
            return failResult(
              spec,
              `Failed to resolve import "package-that-does-not-exist" from "src/App.tsx"`
            )
          }
          return okResult(spec)
        },
        repairFn: async ({ diagnostic }) => {
          expect(diagnostic.file).toBe('src/App.tsx')
          return [
            {
              path: 'src/App.tsx',
              content: good,
              description: 'Remove bad import',
            },
          ]
        },
        checkPreview: async () => ({ ok: true, url: 'http://127.0.0.1:5174/' }),
      })
    )

    expect(await sandbox.readFile('src/App.tsx')).toBe(good)
    expect(history.records.length).toBeGreaterThanOrEqual(1)
    expect(events.some((e) => e.type === 'file_write')).toBe(true)
    expect(events.some((e) => e.type === 'diagnostic')).toBe(true)
    expect(builds).toBeGreaterThanOrEqual(2)
    expect(result.buildOk).toBe(true)
    expect(result.previewHealthOk).toBe(true)
    expect(result.gate.success).toBe(true)
    expect(result.repairAttempts).toBe(1)
  })

  it('G: repair budget exhausted → final failure', async () => {
    const sandbox = createLocalSandboxFilesystem(tempRoot)
    const history = createInMemoryDurableHistory()
    const emitter = createRuntimeEmitter('p3-g', () => {})
    const persistMutation = createPersistMutationFn({
      projectId: 'p3-g',
      planId: 'p3-g',
      sandbox,
      appendDurableHistory: history.append,
      emitter,
      alreadyLocked: true,
    })

    const result = await withProjectMutationLock('p3-g', () =>
      runPhase3InstallBuildRepair({
        projectId: 'p3-g',
        planId: 'p3-g',
        sandbox,
        emitter,
        persistMutation,
        fileMap: { 'src/App.tsx': { content: 'broken' } },
        writtenPaths: ['src/App.tsx'],
        runCommand: async (_root, spec) =>
          failResult(spec, 'Failed to resolve import "still-broken" from "src/App.tsx"'),
        repairFn: async () => [
          { path: 'src/App.tsx', content: 'still broken import "still-broken"', description: 'noop' },
        ],
        checkPreview: async () => ({ ok: true }),
      })
    )

    expect(result.repairAttempts).toBe(MAX_REPAIR_ATTEMPTS)
    expect(result.buildAttempts).toBeLessThanOrEqual(MAX_BUILD_ATTEMPTS)
    expect(result.gate.success).toBe(false)
  })

  it('H: preview smoke fail-closed on network error', async () => {
    const health = await checkPreviewHealth({
      previewUrl: 'http://127.0.0.1:59999/',
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED')
      },
    })
    expect(health.ok).toBe(false)
    expect(health.reason).toMatch(/ECONNREFUSED|Smoke failed/i)

    const sandbox = createLocalSandboxFilesystem(tempRoot)
    const history = createInMemoryDurableHistory()
    const emitter = createRuntimeEmitter('p3-h', () => {})
    const persistMutation = createPersistMutationFn({
      projectId: 'p3-h',
      planId: 'p3-h',
      sandbox,
      appendDurableHistory: history.append,
      emitter,
      alreadyLocked: true,
    })

    const result = await withProjectMutationLock('p3-h', () =>
      runPhase3InstallBuildRepair({
        projectId: 'p3-h',
        planId: 'p3-h',
        sandbox,
        emitter,
        persistMutation,
        fileMap: {},
        writtenPaths: ['src/App.tsx'],
        runCommand: async (_root, spec) => okResult(spec),
        checkPreview: async () => ({ ok: false, reason: 'Smoke failed: network error' }),
      })
    )

    expect(result.buildOk).toBe(true)
    expect(result.previewHealthOk).toBe(false)
    expect(result.gate.success).toBe(false)
    expect(result.gate.failures).toContain('preview_health_failed')
  })

  it('I: lock covers phase3 pipeline; different projects concurrent', async () => {
    let concurrent = 0
    let max = 0
    const run = async (id: string) =>
      withProjectMutationLock(id, async () => {
        concurrent += 1
        max = Math.max(max, concurrent)
        await new Promise((r) => setTimeout(r, 30))
        concurrent -= 1
      })

    await Promise.all([run('same'), run('same')])
    expect(max).toBe(1)

    max = 0
    concurrent = 0
    await Promise.all([run('a'), run('b')])
    expect(max).toBe(2)
    expect(isProjectMutationLockHeld('a')).toBe(false)
  })

  it('I2: lock released after phase3 failure', async () => {
    const sandbox = createLocalSandboxFilesystem(tempRoot)
    const history = createInMemoryDurableHistory()
    const emitter = createRuntimeEmitter('p3-i2', () => {})
    const persistMutation = createPersistMutationFn({
      projectId: 'p3-i2',
      planId: 'p3-i2',
      sandbox,
      appendDurableHistory: history.append,
      emitter,
      alreadyLocked: true,
    })

    await withProjectMutationLock('p3-i2', () =>
      runPhase3InstallBuildRepair({
        projectId: 'p3-i2',
        planId: 'p3-i2',
        sandbox,
        emitter,
        persistMutation,
        fileMap: {},
        writtenPaths: ['package.json'],
        runCommand: async (_root, spec) => failResult(spec, 'install boom'),
        checkPreview: async () => ({ ok: true }),
      })
    )
    expect(isProjectMutationLockHeld('p3-i2')).toBe(false)
  })

  it('rejects disallowed execute_command kinds', () => {
    expect(() => resolveAllowlistedCommand('rm -rf /')).toThrow(/not allowlisted|rejected/i)
    expect(() => resolveAllowlistedCommand('curl')).toThrow(/not allowlisted|rejected/i)
    expect(() => resolveAllowlistedCommand('install', { packages: ['lodash;rm'] })).toThrow(
      /unsafe|rejected/i
    )
    const ok = resolveAllowlistedCommand('build', { pm: 'bun' })
    expect(ok.kind).toBe('build')
  })

  it('J-acceptance: bad import → diagnose → persist repair → rebuild → preview → gate', async () => {
    const sandbox = createLocalSandboxFilesystem(tempRoot)
    await mkdir(path.join(tempRoot, 'src'), { recursive: true })
    const history = createInMemoryDurableHistory()
    const events: AgentEvent[] = []
    const emitter = createRuntimeEmitter('p3-j', (e) => events.push(e))

    // Initial authoritative write (Phase 2 path) under lock
    await withProjectMutationLock('p3-j', async () => {
      const persistMutation = createPersistMutationFn({
        projectId: 'p3-j',
        planId: 'p3-j',
        sandbox,
        appendDurableHistory: history.append,
        emitter,
        alreadyLocked: true,
      })

      const write = await persistAgentMutation({
        projectId: 'p3-j',
        planId: 'p3-j',
        operation: 'write_file',
        path: 'src/App.tsx',
        content:
          'import Missing from "package-that-does-not-exist"\nexport default function App(){return <main/>}',
        description: 'bad import',
        sandbox,
        appendDurableHistory: history.append,
        alreadyLocked: true,
        emitFileEvent: ({ path, bytes, description }) =>
          emitter.fileWrite(path, bytes, description),
      })
      expect(write.ok).toBe(true)
      expect(await sandbox.readFile('src/App.tsx')).toContain('package-that-does-not-exist')

      const fileMap: Record<string, { content?: string }> = {
        'src/App.tsx': { content: (await sandbox.readFile('src/App.tsx')) || '' },
      }

      let buildN = 0
      const phase3 = await runPhase3InstallBuildRepair({
        projectId: 'p3-j',
        planId: 'p3-j',
        sandbox,
        emitter,
        persistMutation,
        fileMap,
        writtenPaths: ['src/App.tsx'],
        runCommand: async (_root, spec) => {
          if (spec.kind !== 'build') return okResult(spec)
          buildN += 1
          const c = await sandbox.readFile('src/App.tsx')
          if (c?.includes('package-that-does-not-exist')) {
            return failResult(
              spec,
              `Failed to resolve import "package-that-does-not-exist" from "src/App.tsx"`
            )
          }
          return okResult(spec)
        },
        repairFn: async () => [
          {
            path: 'src/App.tsx',
            content: 'export default function App(){ return <main>ok</main> }',
            description: 'repair bad import',
          },
        ],
        checkPreview: async () => ({ ok: true, url: 'http://127.0.0.1:5174/' }),
      })

      expect(await sandbox.readFile('src/App.tsx')).toContain('<main>ok</main>')
      expect(await sandbox.readFile('src/App.tsx')).not.toContain('package-that-does-not-exist')
      expect(history.records.length).toBeGreaterThanOrEqual(2)
      expect(events.map((e) => e.type)).toContain('diagnostic')
      expect(events.map((e) => e.type)).toContain('file_write')
      expect(events.map((e) => e.type)).toContain('build_success')
      expect(events.map((e) => e.type)).toContain('preview_status')
      expect(buildN).toBeGreaterThanOrEqual(2)
      expect(phase3.gate.success).toBe(true)
      expect(phase3.gate.writesOk).toBe(true)
      expect(phase3.gate.buildOk).toBe(true)
      expect(phase3.gate.previewHealthOk).toBe(true)
    })

    expect(isProjectMutationLockHeld('p3-j')).toBe(false)
  })
})
