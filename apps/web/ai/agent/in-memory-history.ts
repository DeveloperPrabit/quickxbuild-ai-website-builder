/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * in-memory-history.ts — In-memory durable history for Phase 2 tests
 */

import type { DurableMutationRecord } from './persist-mutation'

/**
 * In-memory durable history store for Phase 2 tests (no DB).
 */
export function createInMemoryDurableHistory() {
  const records: DurableMutationRecord[] = []
  return {
    records,
    append: async (record: DurableMutationRecord) => {
      records.push({ ...record, diff: [...record.diff] })
    },
  }
}
