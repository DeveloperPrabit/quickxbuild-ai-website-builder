/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * runtime-capabilities.ts — Capability flags (flip only when integration tests prove behavior)
 *
 * it.fails guards in agent-runtime-capability-guards.test.ts are NOT live E2E tests.
 * Phase 5 RAG stays blocked until all prerequisites are true.
 */

/** Which Agent Runtime roadmap capabilities are implemented in this build. */
export type AgentRuntimeCapabilities = {
  /** Phase 0: frozen canonical event schema + operation-aware success gate. */
  contracts: boolean
  /** Phase 1: tool/file events stream while tools execute (proven by agent-runtime-streaming.test.ts). */
  streamedToolEvents: boolean
  /** Phase 2: write_file/apply_patch persist to sandbox during execute; file_write only then. */
  immediateSandboxPersist: boolean
  /** Phase 2/3: only one mutating generation per project sandbox. */
  projectMutationLock: boolean
  /** Phase 3: install / build / repair tools inside the same AgentRuntime. */
  installBuildRepair: boolean
  /** Phase 3: Vite transform errors normalized into ViteDiagnostic. */
  viteDiagnostics: boolean
  /** Phase 3: success gate enforced on agent_done for mutations. */
  successGateEnforced: boolean
  /** Phase 4: XML is compatibility adapter only (not a second writer). */
  xmlAdapterOnly: boolean
  /**
   * Phase 6: full fail-closed preview smoke against real preview origin.
   * Catch→ok:false may land earlier; this flag stays false until Phase 6 harness is complete.
   */
  failClosedSmoke: boolean
  /** Live sandbox E2E (Nepal site + missing-package repair) proven — not capability stubs. */
  e2eAcceptance: boolean
  /** Phase 5 RAG — blocked until all above are true. */
  ragEnabled: boolean
}

/**
 * Current capability matrix for Agent Runtime.
 * Flip a flag only when an integration test proves the behavior — never because a stub "passes".
 */
export const AGENT_RUNTIME_CAPABILITIES: AgentRuntimeCapabilities = {
  contracts: true,
  streamedToolEvents: true,
  immediateSandboxPersist: true,
  projectMutationLock: true,
  installBuildRepair: true,
  viteDiagnostics: true,
  successGateEnforced: true,
  xmlAdapterOnly: true,
  failClosedSmoke: false,
  e2eAcceptance: true,
  ragEnabled: false,
}

/** True when Phase 5 RAG may begin (prerequisites green). RAG itself stays off until enabled. */
export function isRagUnblocked(
  caps: AgentRuntimeCapabilities = AGENT_RUNTIME_CAPABILITIES
): boolean {
  return (
    caps.contracts &&
    caps.streamedToolEvents &&
    caps.immediateSandboxPersist &&
    caps.projectMutationLock &&
    caps.installBuildRepair &&
    caps.viteDiagnostics &&
    caps.successGateEnforced &&
    caps.xmlAdapterOnly &&
    caps.failClosedSmoke &&
    caps.e2eAcceptance
  )
}
