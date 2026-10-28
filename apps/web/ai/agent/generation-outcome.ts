/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * generation-outcome.ts — Authoritative mutation outcome helpers (Phase 4 correction)
 *
 * Phase 3 gate success is NOT equivalent to loopResult.applied.
 * XML fallback must never run after Phase 3 has executed.
 */

import type { AgentLoopResult } from './loop'
import type { AgentRunGateResult } from './runtime-gate'

/**
 * XML compatibility fallback is allowed only when the Agent tool loop did not
 * produce an applicable mutation AND Phase 3 never ran.
 * Forbidden: Phase 3 gate failed → XML second writer.
 */
export function shouldFallBackToXmlCompatibility(input: {
  mustApply: boolean
  loopError: unknown
  loopResult: AgentLoopResult | null | undefined
}): boolean {
  if (!input.mustApply) return false
  // Provider refused the account (no credits / bad key) — the XML path would hit the same wall
  if (input.loopResult?.providerError) return false
  // Phase 3 already executed (pass or fail) — never start XML as a second attempt
  if (input.loopResult?.phase3Gate) return false
  // Writes applied without Phase 3 (e.g. no sandbox) — do not re-write via XML
  if (input.loopResult?.applied) return false
  if (input.loopError || !input.loopResult) return true
  return true
}

/**
 * Machine ledger status for a completed stream. Phase 3 gate is authoritative
 * for mutation requests; stream completion alone is not success.
 *
 * Truth Table:
 * - mutation + incomplete stream => FAILED
 * - mutation + complete stream + missing gate => FAILED
 * - mutation + complete stream + failed gate => FAILED
 * - mutation + complete stream + successful gate => SUCCESS
 * - read_only + incomplete stream => FAILED
 * - read_only + complete stream + missing gate => SUCCESS
 * - read_only + complete stream + failed gate => FAILED
 * - read_only + complete stream + successful gate => SUCCESS
 */
export function resolveAiExecutionBuildStatus(input: {
  operation?: 'mutation' | 'read_only'
  phase3Gate?: AgentRunGateResult
  streamCompleted: boolean
}): 'SUCCESS' | 'FAILED' {
  if (!input.streamCompleted) return 'FAILED'
  const op = input.operation ?? 'mutation'
  if (op === 'mutation') {
    if (!input.phase3Gate || input.phase3Gate.success !== true) {
      return 'FAILED'
    }
    return 'SUCCESS'
  }
  // read_only: stream completion alone is SUCCESS unless a gate explicitly ran and failed
  if (input.phase3Gate && input.phase3Gate.success === false) {
    return 'FAILED'
  }
  return 'SUCCESS'
}
