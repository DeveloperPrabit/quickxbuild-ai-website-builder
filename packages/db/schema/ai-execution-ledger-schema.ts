/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * ai-execution-ledger-schema.ts
 * Copyright (C) 2025 Nextify Limited
 *
 * Append-only R&D ledger for AI pipeline runs (training / audit datasets).
 * Do not UPDATE or DELETE rows from application code.
 */

import { createId } from '@paralleldrive/cuid2'
import { sql } from 'drizzle-orm'
import { integer, jsonb, pgTable, text, timestamp, index } from 'drizzle-orm/pg-core'

export const AI_EXECUTION_BUILD_STATUS = {
  SUCCESS: 'success',
  FAILED: 'failed',
  ABORTED: 'aborted',
} as const

export type AiExecutionBuildStatus =
  (typeof AI_EXECUTION_BUILD_STATUS)[keyof typeof AI_EXECUTION_BUILD_STATUS]

/**
 * Immutable AI execution log: prompt, plan, code output summary, build status.
 */
export const aiExecutionLedger = pgTable(
  'ai_execution_ledger',
  {
    id: text('id')
      .$defaultFn(() => createId())
      .primaryKey(),
    tenantId: text('tenant_id').notNull(),
    projectId: text('project_id').notNull(),
    planId: text('plan_id'),
    prompt: text('prompt').notNull(),
    planSummary: text('plan_summary'),
    codeOutput: text('code_output'),
    buildStatus: text('build_status').notNull(),
    creditCost: integer('credit_cost').notNull().default(1),
    modelId: text('model_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at', {
      withTimezone: true,
      mode: 'string',
    })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index('ai_execution_ledger_tenant_created_idx').on(table.tenantId, table.createdAt),
    index('ai_execution_ledger_project_created_idx').on(table.projectId, table.createdAt),
  ]
)
