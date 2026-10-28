/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * app-data-schema.ts
 * Copyright (C) 2025 Nextify Limited
 *
 * Unified multi-tenant application data store.
 * Generated apps never connect to Postgres directly — they use the data proxy.
 */

import { createId } from '@paralleldrive/cuid2'
import { sql } from 'drizzle-orm'
import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

/**
 * Row-level tenant-scoped JSON documents for generated applications.
 * All reads/writes must be filtered by tenant_id (+ project_id) on the server.
 */
export const appData = pgTable(
  'app_data',
  {
    id: text('id')
      .$defaultFn(() => createId())
      .primaryKey(),
    /** Organization / workspace id (D1 org id string). */
    tenantId: text('tenant_id').notNull(),
    /** QuickXBuild project id that owns this document. */
    projectId: text('project_id').notNull(),
    /** Logical collection name (e.g. products, orders). */
    collection: text('collection').notNull().default('default'),
    /** Optional client-stable key within a collection. */
    recordKey: text('record_key'),
    /** Structural application payload. */
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', {
      withTimezone: true,
      mode: 'string',
    }).default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updated_at', {
      withTimezone: true,
      mode: 'string',
    })
      .defaultNow()
      .notNull()
      .$onUpdate(() => sql`now()`),
  },
  (table) => [
    index('app_data_tenant_project_idx').on(table.tenantId, table.projectId),
    index('app_data_tenant_project_collection_idx').on(
      table.tenantId,
      table.projectId,
      table.collection
    ),
    uniqueIndex('app_data_tenant_project_collection_key_uidx').on(
      table.tenantId,
      table.projectId,
      table.collection,
      table.recordKey
    ),
  ]
)
