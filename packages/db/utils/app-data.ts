/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * app-data.ts
 * Copyright (C) 2025 Nextify Limited
 *
 * Tenant-scoped CRUD for app_data. Always requires tenantId + projectId.
 */

import { and, desc, eq, sql } from 'drizzle-orm'
import { appData } from '../schema/app-data-schema'

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

export type AppDataRecord = {
  id: string
  tenantId: string
  projectId: string
  collection: string
  recordKey: string | null
  data: Record<string, unknown>
  createdAt: string | null
  updatedAt: string
}

function toRecord(row: typeof appData.$inferSelect): AppDataRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    projectId: row.projectId,
    collection: row.collection,
    recordKey: row.recordKey ?? null,
    data: (row.data ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt,
  }
}

/** List documents for a tenant/project (optional collection filter). */
export async function listAppData(params: {
  tenantId: string
  projectId: string
  collection?: string
  limit?: number
}): Promise<AppDataRecord[]> {
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 500)
  return withDb(async (db) => {
    const conditions = [
      eq(appData.tenantId, params.tenantId),
      eq(appData.projectId, params.projectId),
    ]
    if (params.collection) {
      conditions.push(eq(appData.collection, params.collection))
    }
    const rows = await db
      .select()
      .from(appData)
      .where(and(...conditions))
      .orderBy(desc(appData.updatedAt))
      .limit(limit)
    return rows.map(toRecord)
  })
}

/** Fetch one document by id (tenant-bound). */
export async function getAppDataById(params: {
  tenantId: string
  projectId: string
  id: string
}): Promise<AppDataRecord | null> {
  return withDb(async (db) => {
    const row = await db.query.appData.findFirst({
      where: and(
        eq(appData.id, params.id),
        eq(appData.tenantId, params.tenantId),
        eq(appData.projectId, params.projectId)
      ),
    })
    return row ? toRecord(row) : null
  })
}

/** Insert a new document. */
export async function createAppData(params: {
  tenantId: string
  projectId: string
  collection?: string
  recordKey?: string | null
  data: Record<string, unknown>
}): Promise<AppDataRecord> {
  return withDb(async (db) => {
    const inserted = await db
      .insert(appData)
      .values({
        tenantId: params.tenantId,
        projectId: params.projectId,
        collection: params.collection || 'default',
        recordKey: params.recordKey ?? null,
        data: params.data,
      })
      .returning()
    const row = inserted[0]
    if (!row) throw new Error('Failed to create app_data row')
    return toRecord(row)
  })
}

/** Upsert by collection + recordKey (tenant-bound). */
export async function upsertAppData(params: {
  tenantId: string
  projectId: string
  collection?: string
  recordKey: string
  data: Record<string, unknown>
}): Promise<AppDataRecord> {
  const collection = params.collection || 'default'
  return withDb(async (db) => {
    const inserted = await db
      .insert(appData)
      .values({
        tenantId: params.tenantId,
        projectId: params.projectId,
        collection,
        recordKey: params.recordKey,
        data: params.data,
      })
      .onConflictDoUpdate({
        target: [appData.tenantId, appData.projectId, appData.collection, appData.recordKey],
        set: {
          data: params.data,
          updatedAt: sql`now()`,
        },
      })
      .returning()
    const row = inserted[0]
    if (!row) throw new Error('Failed to upsert app_data row')
    return toRecord(row)
  })
}

/** Patch data JSON for an existing id (tenant-bound). */
export async function updateAppData(params: {
  tenantId: string
  projectId: string
  id: string
  data: Record<string, unknown>
}): Promise<AppDataRecord | null> {
  return withDb(async (db) => {
    const updated = await db
      .update(appData)
      .set({
        data: params.data,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(appData.id, params.id),
          eq(appData.tenantId, params.tenantId),
          eq(appData.projectId, params.projectId)
        )
      )
      .returning()
    const row = updated[0]
    return row ? toRecord(row) : null
  })
}

/** Delete by id (tenant-bound). Returns true if a row was removed. */
export async function deleteAppData(params: {
  tenantId: string
  projectId: string
  id: string
}): Promise<boolean> {
  return withDb(async (db) => {
    const deleted = await db
      .delete(appData)
      .where(
        and(
          eq(appData.id, params.id),
          eq(appData.tenantId, params.tenantId),
          eq(appData.projectId, params.projectId)
        )
      )
      .returning({ id: appData.id })
    return deleted.length > 0
  })
}
