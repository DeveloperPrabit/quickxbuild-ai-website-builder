import { createHmac } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod/v4'
import { APP_URL, requireAdmin, requireAuth } from '../auth'
import { getDb } from '../db'
import { emitPaymentsChanged } from '../realtime'
import { payments, type User } from '../schema'
import { markPaymentStatus } from '../settle'

type AuthEnv = {
  Variables: {
    user: User
  }
}

export type CheckoutInput = z.infer<typeof CheckoutInput>
export const CheckoutInput = z.object({
  amount: z.int().min(1),
  currency: z.string().min(3).max(8).optional().default('usd'),
  description: z.string().max(200).optional().default('Order'),
  provider: z.enum(['stripe', 'esewa', 'paytm', 'khalti']).optional().default('stripe'),
  orderId: z.string().optional(),
})

export const paymentsRouter = new Hono<AuthEnv>()

paymentsRouter.use('*', requireAuth)

paymentsRouter.get('/', async (c) => {
  const user = c.get('user')
  const db = getDb()
  const rows = await db
    .select()
    .from(payments)
    .where(eq(payments.userId, user.id))
    .orderBy(desc(payments.createdAt))
  return c.json({ payments: rows })
})

paymentsRouter.post('/checkout', async (c) => {
  const parsed = CheckoutInput.safeParse(await c.req.json())
  if (!parsed.success) {
    throw new HTTPException(400, { message: 'Invalid checkout payload' })
  }

  if (parsed.data.provider === 'esewa') {
    return startEsewa(c, parsed.data)
  }
  if (parsed.data.provider === 'paytm') {
    return startPaytm(c, parsed.data)
  }
  if (parsed.data.provider === 'khalti') {
    return startKhalti(c, parsed.data)
  }
  return startStripe(c, parsed.data)
})

paymentsRouter.post('/:id/refund', requireAdmin, async (c) => {
  const db = getDb()
  const [current] = await db.select().from(payments).where(eq(payments.id, c.req.param('id'))).limit(1)
  if (!current) {
    throw new HTTPException(404, { message: 'Payment not found' })
  }
  if (current.status !== 'paid') {
    throw new HTTPException(400, { message: 'Only paid payments can be refunded' })
  }

  const configured = {
    stripe: Boolean(process.env.STRIPE_SECRET_KEY),
    esewa: Boolean(process.env.ESEWA_SECRET_KEY),
    paytm: Boolean(process.env.PAYTM_MERCHANT_KEY),
    khalti: Boolean(process.env.KHALTI_SECRET_KEY),
  }[current.provider]
  if (!configured) {
    throw new HTTPException(501, { message: `${current.provider} is not configured for refunds.` })
  }

  const payment = await markPaymentStatus(current.id, 'refunded')
  return c.json({ payment })
})

async function insertPending(userId: string, input: CheckoutInput) {
  const db = getDb()
  const [payment] = await db.insert(payments).values({
    id: crypto.randomUUID(),
    userId,
    provider: input.provider,
    status: 'pending',
    amount: input.amount,
    currency: input.currency,
    description: input.orderId ? `order:${input.orderId}` : input.description,
  }).returning()
  emitPaymentsChanged({ action: 'created', paymentId: payment.id, payment })
  return payment
}

async function startStripe(c: any, input: CheckoutInput) {
  const secret = process.env.STRIPE_SECRET_KEY
  if (!secret) {
    throw new HTTPException(501, { message: 'Stripe is not configured. Set STRIPE_SECRET_KEY.' })
  }

  const user = c.get('user')
  const payment = await insertPending(user.id, input)
  const params = new URLSearchParams({
    mode: 'payment',
    success_url: `${APP_URL}/dashboard?paid=${payment.id}`,
    cancel_url: `${APP_URL}/dashboard?canceled=${payment.id}`,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': input.currency,
    'line_items[0][price_data][unit_amount]': String(input.amount),
    'line_items[0][price_data][product_data][name]': input.description,
    client_reference_id: payment.id,
  })

  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  })
  const session = await response.json() as { id?: string; url?: string; error?: { message?: string } }
  if (!response.ok || !session.url) {
    throw new HTTPException(502, { message: session.error?.message || 'Stripe checkout failed' })
  }

  const db = getDb()
  const [updated] = await db.update(payments).set({
    externalId: session.id,
    updatedAt: new Date(),
  }).where(eq(payments.id, payment.id)).returning()
  emitPaymentsChanged({ action: 'updated', paymentId: updated.id, payment: updated })
  return c.json({ payment: updated, url: session.url })
}

async function startEsewa(c: any, input: CheckoutInput) {
  const productCode = process.env.ESEWA_PRODUCT_CODE
  const secret = process.env.ESEWA_SECRET_KEY
  if (!productCode || !secret) {
    throw new HTTPException(501, { message: 'eSewa is not configured. Set ESEWA_PRODUCT_CODE and ESEWA_SECRET_KEY.' })
  }

  const user = c.get('user')
  const payment = await insertPending(user.id, { ...input, currency: 'npr' })
  const total = (input.amount / 100).toFixed(2)
  const signed = `total_amount=${total},transaction_uuid=${payment.id},product_code=${productCode}`
  const signature = createHmac('sha256', secret).update(signed).digest('base64')
  const endpoint = process.env.ESEWA_FORM_URL || 'https://rc-epay.esewa.com.np/api/epay/main/v2/form'

  return c.json({
    payment,
    url: endpoint,
    fields: {
      amount: total,
      tax_amount: '0',
      total_amount: total,
      transaction_uuid: payment.id,
      product_code: productCode,
      product_service_charge: '0',
      product_delivery_charge: '0',
      success_url: `${APP_URL}/dashboard?esewa=${payment.id}`,
      failure_url: `${APP_URL}/dashboard?canceled=${payment.id}`,
      signed_field_names: 'total_amount,transaction_uuid,product_code',
      signature,
    },
  })
}

async function startPaytm(c: any, input: CheckoutInput) {
  if (!process.env.PAYTM_MID || !process.env.PAYTM_MERCHANT_KEY) {
    throw new HTTPException(501, { message: 'Paytm is not configured. Set PAYTM_MID and PAYTM_MERCHANT_KEY.' })
  }
  const user = c.get('user')
  const payment = await insertPending(user.id, { ...input, currency: input.currency || 'inr' })
  return c.json({
    payment,
    url: process.env.PAYTM_HOST || 'https://securegw-stage.paytm.in/theia/processTransaction',
    fields: {
      MID: process.env.PAYTM_MID,
      ORDER_ID: payment.id,
      TXN_AMOUNT: (input.amount / 100).toFixed(2),
      CHANNEL_ID: 'WEB',
      INDUSTRY_TYPE_ID: 'Retail',
      WEBSITE: 'WEBSTAGING',
      CALLBACK_URL: `${APP_URL}/api/webhooks/paytm`,
    },
  })
}

async function startKhalti(c: any, input: CheckoutInput) {
  const secret = process.env.KHALTI_SECRET_KEY
  if (!secret) {
    throw new HTTPException(501, { message: 'Khalti is not configured. Set KHALTI_SECRET_KEY.' })
  }
  const user = c.get('user')
  const payment = await insertPending(user.id, { ...input, currency: 'npr' })
  const response = await fetch('https://dev.khalti.com/api/v2/epayment/initiate/', {
    method: 'POST',
    headers: {
      Authorization: `Key ${secret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      return_url: `${APP_URL}/dashboard?khalti=${payment.id}`,
      website_url: APP_URL,
      amount: input.amount,
      purchase_order_id: payment.id,
      purchase_order_name: input.description,
    }),
  })
  const data = await response.json() as { payment_url?: string; error_key?: string }
  if (!response.ok || !data.payment_url) {
    throw new HTTPException(502, { message: 'Khalti checkout failed' })
  }
  return c.json({ payment, url: data.payment_url })
}
