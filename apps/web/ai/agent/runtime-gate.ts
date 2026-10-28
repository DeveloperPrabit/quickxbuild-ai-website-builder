/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * runtime-gate.ts — Operation-aware Agent Runtime success gate (Phase 0 contract)
 *
 * Mutation / build requests:
 *   writesOk ∧ (installOk if installRequired) ∧ buildOk ∧ previewHealthOk
 * Read-only requests:
 *   do not require file writes (or install/build/preview)
 * Do not weaken the mutation gate.
 */

import { z } from 'zod/v4'

/** Inputs used to decide whether an AgentRuntime generation succeeded. */
export type AgentRunGateInput = z.infer<typeof AgentRunGateInput>
/** Inputs used to decide whether an AgentRuntime generation succeeded. */
export const AgentRunGateInput = z.object({
  /** mutation = must write/build/preview; read_only = Q&A / inspect. */
  operation: z.enum(['mutation', 'read_only']).default('mutation'),
  /** At least one sandbox-persisted file write succeeded (mutation only). */
  writesOk: z.boolean(),
  /** True when package.json / deps changed and install must run. */
  installRequired: z.boolean(),
  /** Install succeeded, or not required. */
  installOk: z.boolean(),
  /** Allowlisted build exited 0 (mutation only). */
  buildOk: z.boolean(),
  /** Fail-closed preview smoke / health succeeded (mutation only). */
  previewHealthOk: z.boolean(),
})

/** Result of evaluating the Agent Runtime acceptance gate. */
export type AgentRunGateResult = z.infer<typeof AgentRunGateResult>
/** Result of evaluating the Agent Runtime acceptance gate. */
export const AgentRunGateResult = z.object({
  success: z.boolean(),
  operation: z.enum(['mutation', 'read_only']),
  writesOk: z.boolean(),
  installRequired: z.boolean(),
  installOk: z.boolean(),
  buildOk: z.boolean(),
  previewHealthOk: z.boolean(),
  /** Machine-readable failure codes when success is false. */
  failures: z.array(z.string()),
})

/**
 * Evaluate whether an AgentRuntime generation may report overall success.
 * Do not report success based on model prose alone.
 */
export function evaluateAgentRunGate(input: z.input<typeof AgentRunGateInput>): AgentRunGateResult {
  const parsed = AgentRunGateInput.parse(input)

  if (parsed.operation === 'read_only') {
    return AgentRunGateResult.parse({
      success: true,
      operation: 'read_only',
      writesOk: parsed.writesOk,
      installRequired: false,
      installOk: true,
      buildOk: true,
      previewHealthOk: true,
      failures: [],
    })
  }

  const failures: string[] = []
  if (!parsed.writesOk) {
    failures.push('writes_failed')
  }
  if (parsed.installRequired && !parsed.installOk) {
    failures.push('install_failed')
  }
  if (!parsed.buildOk) {
    failures.push('build_failed')
  }
  if (!parsed.previewHealthOk) {
    failures.push('preview_health_failed')
  }

  const installOk = parsed.installRequired ? parsed.installOk : true

  return AgentRunGateResult.parse({
    success: parsed.writesOk && installOk && parsed.buildOk && parsed.previewHealthOk,
    operation: 'mutation',
    writesOk: parsed.writesOk,
    installRequired: parsed.installRequired,
    installOk: parsed.installRequired ? parsed.installOk : true,
    buildOk: parsed.buildOk,
    previewHealthOk: parsed.previewHealthOk,
    failures,
  })
}
