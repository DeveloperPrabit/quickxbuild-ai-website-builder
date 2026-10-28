/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * durable-history.ts — Append Agent Runtime mutation records to project.messageHistory
 */

import { eq } from 'drizzle-orm'
import { getDbAsync } from '@quickxbuild/db'
import { project } from '@quickxbuild/db/schema/project-schema'
import type { DurableMutationRecord } from './persist-mutation'

/**
 * Append one durable mutation record to project.messageHistory.
 * Reuses the existing HistoryType / diff message model.
 */
export async function appendDurableMutationToProjectHistory(
  projectId: string,
  record: DurableMutationRecord
): Promise<void> {
  const db = await getDbAsync()
  const rows = await db
    .select({ messageHistory: project.messageHistory })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1)

  const current = rows[0]
  if (!current) {
    throw new Error(`Project not found for durable history: ${projectId}`)
  }

  let history: unknown[] = []
  try {
    history = JSON.parse(current.messageHistory || '[]') as unknown[]
    if (!Array.isArray(history)) history = []
  } catch {
    history = []
  }

  history.push({
    type: 'diff',
    planId: record.planId,
    contentType: 'files',
    diff: record.diff,
    projectId: record.projectId,
    timestamp: record.timestamp,
    operation: record.operation,
    success: record.success,
    persistedByAgentRuntime: true,
  })

  await db
    .update(project)
    .set({ messageHistory: JSON.stringify(history) })
    .where(eq(project.id, projectId))
}
