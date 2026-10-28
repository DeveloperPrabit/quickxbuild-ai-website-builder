/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * agent-runtime-capability-guards.test.ts — Roadmap capability guards (NOT live sandbox E2E)
 *
 * These it.fails stubs only assert AGENT_RUNTIME_CAPABILITIES flags.
 * They are NOT proof that sandbox/build/preview work.
 * Flip a flag only when a real integration test proves the behavior.
 */

import { describe, expect, it } from 'vitest'
import { AGENT_RUNTIME_CAPABILITIES, isRagUnblocked } from '../agent/runtime-capabilities'

/** Locked greenfield acceptance prompt (for future live E2E harness — not this file). */
export const NEPAL_TRAVEL_ACCEPTANCE_PROMPT =
  'Build a modern Nepal travel agency website with navbar, hero, destinations, 6 destination cards, tour packages, about, testimonials, contact, footer, responsive mobile design and working navigation.'

/** Locked induced-failure import for future live E2E harness — not this file. */
export const MISSING_PACKAGE_IMPORT = 'import X from "package-that-does-not-exist"'

describe('Agent Runtime capability guards (not live E2E)', () => {
  it('capability proven: streamedToolEvents (Phase 1) — see agent-runtime-streaming.test.ts', () => {
    expect(AGENT_RUNTIME_CAPABILITIES.streamedToolEvents).toBe(true)
  })

  it('capability proven: immediateSandboxPersist (Phase 2) — see agent-runtime-phase2-persist.test.ts', () => {
    expect(AGENT_RUNTIME_CAPABILITIES.immediateSandboxPersist).toBe(true)
  })

  it('capability proven: projectMutationLock (Phase 2) — see agent-runtime-phase2-persist.test.ts', () => {
    expect(AGENT_RUNTIME_CAPABILITIES.projectMutationLock).toBe(true)
  })

  it('capability proven: installBuildRepair (Phase 3) — see agent-runtime-phase3.test.ts', () => {
    expect(AGENT_RUNTIME_CAPABILITIES.installBuildRepair).toBe(true)
  })

  it('capability proven: viteDiagnostics (Phase 3) — see agent-runtime-phase3.test.ts', () => {
    expect(AGENT_RUNTIME_CAPABILITIES.viteDiagnostics).toBe(true)
  })

  it('capability proven: successGateEnforced (Phase 3) — see agent-runtime-phase3.test.ts', () => {
    expect(AGENT_RUNTIME_CAPABILITIES.successGateEnforced).toBe(true)
  })

  it('capability proven: xmlAdapterOnly (Phase 4) — see agent-runtime-phase4-xml-adapter.test.ts', () => {
    expect(AGENT_RUNTIME_CAPABILITIES.xmlAdapterOnly).toBe(true)
  })

  it.fails('capability guard: failClosedSmoke full harness (Phase 6)', () => {
    expect(AGENT_RUNTIME_CAPABILITIES.failClosedSmoke).toBe(true)
  })

  it('capability proven: e2eAcceptance TheProBuilder gym (product-blueprint-gym-e2e.test.ts)', () => {
    expect(AGENT_RUNTIME_CAPABILITIES.e2eAcceptance).toBe(true)
  })

  it('documents that RAG stays blocked while failClosedSmoke is outstanding', () => {
    expect(AGENT_RUNTIME_CAPABILITIES.ragEnabled).toBe(false)
    expect(isRagUnblocked()).toBe(false)
  })
})
