import { getDb } from './db'
import { ledgerEntries } from './schema'

export async function writeLedger(input: {
  sourceType: 'order' | 'payment' | 'refund'
  sourceId: string
  debit?: number
  credit?: number
  currency: string
  note: string
}) {
  const db = getDb()
  const [row] = await db.insert(ledgerEntries).values({
    id: crypto.randomUUID(),
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    debit: input.debit || 0,
    credit: input.credit || 0,
    currency: input.currency,
    note: input.note,
  }).returning()
  return row
}
