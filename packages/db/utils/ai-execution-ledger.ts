/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * ai-execution-ledger.ts
 * Copyright (C) 2025 Nextify Limited
 *
 * Append-only inserts for AI R&D / training datasets. Never update or delete.
 */

import {
  AI_EXECUTION_BUILD_STATUS,
  aiExecutionLedger,
  type AiExecutionBuildStatus,
} from '../schema/ai-execution-ledger-schema'

async function withDb<T>(
  fn: (db: Awaited<ReturnType<typeof import('../index').getDbAsync>>) => Promise<T>
): Promise<T> {
  const { getDbAsync } = await import('../index')
  const db = await getDbAsync()
  try {
    return await fn(db)
  } finally {
    await (db as { $client?: { end?: () => Promise<void> } }).$client?.end?.()
  }
}

const MAX_PROMPT = 50_000
const MAX_CODE = 100_000
const MAX_PLAN = 20_000

function truncate(value: string | null | undefined, max: number): string | null {
  if (value == null) return null
  if (value.length <= max) return value
  return `${value.slice(0, max)}\n…[truncated]`
}

export type AppendAiExecutionInput = {
  tenantId: string
  projectId: string
  planId?: string | null
  prompt: string
  planSummary?: string | null
  codeOutput?: string | null
  buildStatus: AiExecutionBuildStatus
  creditCost: number
  modelId?: string | null
  metadata?: Record<string, unknown>
}

/** Insert one immutable AI execution ledger row. Failures are logged by caller. */
export async function appendAiExecutionLedger(
  input: AppendAiExecutionInput
): Promise<{ id: string }> {
  return withDb(async (db) => {
    const inserted = await db
      .insert(aiExecutionLedger)
      .values({
        tenantId: input.tenantId,
        projectId: input.projectId,
        planId: input.planId ?? null,
        prompt: truncate(input.prompt, MAX_PROMPT) || '',
        planSummary: truncate(input.planSummary, MAX_PLAN),
        codeOutput: truncate(input.codeOutput, MAX_CODE),
        buildStatus: input.buildStatus,
        creditCost: input.creditCost,
        modelId: input.modelId ?? null,
        metadata: input.metadata ?? {},
      })
      .returning({ id: aiExecutionLedger.id })

    const row = inserted[0]
    if (!row) throw new Error('Failed to append ai_execution_ledger row')
    return row
  })
}

export { AI_EXECUTION_BUILD_STATUS }
