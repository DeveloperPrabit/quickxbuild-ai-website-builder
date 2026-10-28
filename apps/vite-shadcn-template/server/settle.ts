import { eq } from 'drizzle-orm'
import { getDb } from './db'
import { writeLedger } from './ledger'
import { emitOrdersChanged, emitPaymentsChanged } from './realtime'
import { orders, payments } from './schema'

export async function markPaymentStatus(
  paymentId: string,
  status: 'paid' | 'failed' | 'refunded',
  externalId?: string
) {
  const db = getDb()
  const [current] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1)
  if (!current) {
    return null
  }

  const [payment] = await db.update(payments).set({
    status,
    externalId: externalId || current.externalId,
    updatedAt: new Date(),
  }).where(eq(payments.id, paymentId)).returning()

  if (status === 'paid' && current.status !== 'paid') {
    await writeLedger({
      sourceType: 'payment',
      sourceId: payment.id,
      credit: payment.amount,
      currency: payment.currency,
      note: `Paid via ${payment.provider}`,
    })
    if (payment.description.startsWith('order:')) {
      const orderId = payment.description.slice('order:'.length)
      const [order] = await db.update(orders).set({
        status: 'paid',
        updatedAt: new Date(),
      }).where(eq(orders.id, orderId)).returning()
      if (order) {
        emitOrdersChanged({ action: 'updated', orderId: order.id, order })
      }
    }
  }

  if (status === 'refunded' && current.status !== 'refunded') {
    await writeLedger({
      sourceType: 'refund',
      sourceId: payment.id,
      debit: payment.amount,
      currency: payment.currency,
      note: `Refund via ${payment.provider}`,
    })
  }

  emitPaymentsChanged({ action: 'updated', paymentId: payment.id, payment })
  return payment
}
