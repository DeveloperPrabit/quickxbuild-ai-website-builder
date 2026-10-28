/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * runtime-events.test.ts — Phase 0 frozen contract tests
 */

import { describe, expect, it } from 'vitest'
import {
  AGENT_RUNTIME_CAPABILITIES,
  isRagUnblocked,
} from '../agent/runtime-capabilities'
import {
  AGENT_EVENT_SCHEMAS,
  AGENT_EVENT_VERSION,
  AgentEvent,
  CANONICAL_AGENT_EVENT_TYPES,
  FORBIDDEN_AGENT_EVENT_TYPES,
  FileWriteEvent,
  createSandboxFileWriteEvent,
  parseAgentEvent,
} from '../agent/runtime-events'
import { evaluateAgentRunGate } from '../agent/runtime-gate'

const PLAN = 'plan-phase0'

function envelope<T extends string>(type: T, data?: unknown) {
  return {
    type,
    version: AGENT_EVENT_VERSION,
    planId: PLAN,
    ts: 1,
    ...(data !== undefined ? { data } : {}),
  }
}

describe('Phase 0 frozen Agent Runtime contract', () => {
  it('marks contracts true, Phase 1–4 capabilities proven, later phases + RAG blocked', () => {
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
    expect(isRagUnblocked()).toBe(false)
  })

  it('lists every canonical lifecycle event type', () => {
    expect([...CANONICAL_AGENT_EVENT_TYPES]).toEqual([
      'agent_start',
      'step_start',
      'tool_start',
      'tool_result',
      'file_write',
      'file_patch',
      'command_start',
      'command_output',
      'command_result',
      'build_start',
      'build_error',
      'build_success',
      'preview_status',
      'diagnostic',
      'apply_ok',
      'apply_failed',
      'agent_error',
      'agent_done',
    ])
  })

  it('forbids private CoT and obsolete generic event names', () => {
    for (const type of FORBIDDEN_AGENT_EVENT_TYPES) {
      expect(CANONICAL_AGENT_EVENT_TYPES).not.toContain(type)
      expect(parseAgentEvent(envelope(type as 'agent_start', { message: 'x' }))).toBeNull()
    }
  })

  it.each([
    ['agent_start', envelope('agent_start', { operation: 'mutation' })],
    ['step_start', envelope('step_start', { step: 'write', title: 'Writing files' })],
    ['tool_start', envelope('tool_start', { tool: 'read_file', path: 'src/App.tsx' })],
    ['tool_result', envelope('tool_result', { tool: 'read_file', ok: true, path: 'src/App.tsx' })],
    [
      'file_write',
      envelope('file_write', {
        path: 'src/App.tsx',
        bytes: 1234,
        persistedToSandbox: true,
      }),
    ],
    [
      'file_patch',
      envelope('file_patch', {
        path: 'src/App.tsx',
        bytes: 40,
        persistedToSandbox: true,
      }),
    ],
    ['command_start', envelope('command_start', { command: 'bun add lucide-react' })],
    [
      'command_output',
      envelope('command_output', {
        command: 'bun add lucide-react',
        stream: 'stdout',
        chunk: 'installed',
      }),
    ],
    [
      'command_result',
      envelope('command_result', { command: 'bun add lucide-react', exitCode: 0 }),
    ],
    ['build_start', envelope('build_start', { command: 'bun run build' })],
    [
      'build_error',
      envelope('build_error', {
        command: 'bun run build',
        exitCode: 1,
        stderr: 'Failed to resolve import',
      }),
    ],
    ['build_success', envelope('build_success', { command: 'bun run build', exitCode: 0 })],
    ['preview_status', envelope('preview_status', { ok: true, url: 'https://preview.example' })],
    [
      'diagnostic',
      envelope('diagnostic', {
        message: 'Failed to resolve import "x"',
        file: 'src/App.tsx',
        line: 1,
        column: 18,
        source: 'vite-transform',
      }),
    ],
    ['apply_ok', envelope('apply_ok', { content: 'Applied' })],
    ['apply_failed', envelope('apply_failed', { content: 'No writes' })],
    ['agent_error', envelope('agent_error', { message: 'Aborted' })],
    [
      'agent_done',
      envelope('agent_done', {
        success: true,
        gate: {
          operation: 'mutation',
          writesOk: true,
          installOk: true,
          buildOk: true,
          previewHealthOk: true,
          installRequired: false,
        },
      }),
    ],
  ] as const)('parses canonical event %s', (type, payload) => {
    const parsed = parseAgentEvent(payload)
    expect(parsed).not.toBeNull()
    expect(parsed?.type).toBe(type)
    expect(AGENT_EVENT_SCHEMAS[type].parse(payload).type).toBe(type)
    expect(AgentEvent.parse(payload).type).toBe(type)
  })

  it('parses legacy progress/timeline as compatibility status only', () => {
    expect(parseAgentEvent(envelope('progress', { content: 'Writing files…' }))?.type).toBe(
      'progress'
    )
    expect(
      parseAgentEvent(
        envelope('timeline', {
          kind: 'check',
          title: 'Checking project files',
          status: 'running',
        })
      )?.type
    ).toBe('timeline')
  })

  it('rejects file_write / file_patch without persistedToSandbox:true', () => {
    expect(
      FileWriteEvent.safeParse(
        envelope('file_write', { path: 'src/App.tsx', persistedToSandbox: false })
      ).success
    ).toBe(false)
    expect(
      FileWriteEvent.safeParse(envelope('file_write', { path: 'src/App.tsx' })).success
    ).toBe(false)
    expect(
      parseAgentEvent(
        envelope('file_patch', { path: 'src/App.tsx', persistedToSandbox: false })
      )
    ).toBeNull()
  })

  it('createSandboxFileWriteEvent only builds authoritative sandbox events', () => {
    const event = createSandboxFileWriteEvent({
      planId: PLAN,
      path: 'src/App.tsx',
      bytes: 10,
    })
    expect(event.data.persistedToSandbox).toBe(true)
    expect(event.version).toBe(1)
  })

  it('mutation gate requires writes, build, and preview health', () => {
    const incomplete = evaluateAgentRunGate({
      operation: 'mutation',
      writesOk: true,
      installRequired: false,
      installOk: true,
      buildOk: false,
      previewHealthOk: true,
    })
    expect(incomplete.success).toBe(false)
    expect(incomplete.failures).toContain('build_failed')

    const needsInstall = evaluateAgentRunGate({
      operation: 'mutation',
      writesOk: true,
      installRequired: true,
      installOk: false,
      buildOk: true,
      previewHealthOk: true,
    })
    expect(needsInstall.success).toBe(false)
    expect(needsInstall.failures).toContain('install_failed')

    const full = evaluateAgentRunGate({
      operation: 'mutation',
      writesOk: true,
      installRequired: true,
      installOk: true,
      buildOk: true,
      previewHealthOk: true,
    })
    expect(full.success).toBe(true)
    expect(full.failures).toEqual([])
  })

  it('read_only gate does not require writes', () => {
    const result = evaluateAgentRunGate({
      operation: 'read_only',
      writesOk: false,
      installRequired: false,
      installOk: false,
      buildOk: false,
      previewHealthOk: false,
    })
    expect(result.success).toBe(true)
    expect(result.operation).toBe('read_only')
    expect(result.failures).toEqual([])
  })

  it('defaults operation to mutation when omitted', () => {
    const result = evaluateAgentRunGate({
      writesOk: false,
      installRequired: false,
      installOk: true,
      buildOk: true,
      previewHealthOk: true,
    })
    expect(result.operation).toBe('mutation')
    expect(result.success).toBe(false)
    expect(result.failures).toContain('writes_failed')
  })
})
