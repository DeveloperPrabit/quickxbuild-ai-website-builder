import { createHmac, timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { markPaymentStatus } from '../settle'

export const webhooksRouter = new Hono()

function verifyStripeSignature(payload: string, header: string, secret: string): boolean {
  const parts = Object.fromEntries(
    header.split(',').map((item) => {
      const [key, ...rest] = item.split('=')
      return [key, rest.join('=')]
    })
  )
  const timestamp = parts.t
  const expected = parts.v1
  if (!timestamp || !expected) {
    return false
  }

  const digest = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex')
  const expectedBuffer = Buffer.from(expected, 'hex')
  const digestBuffer = Buffer.from(digest, 'hex')
  if (expectedBuffer.length !== digestBuffer.length) {
    return false
  }
  return timingSafeEqual(expectedBuffer, digestBuffer)
}

webhooksRouter.post('/stripe', async (c) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    throw new HTTPException(501, { message: 'Stripe webhook is not configured. Set STRIPE_WEBHOOK_SECRET.' })
  }

  const payload = await c.req.text()
  const header = c.req.header('stripe-signature')
  if (!header || !verifyStripeSignature(payload, header, secret)) {
    throw new HTTPException(400, { message: 'Invalid Stripe signature' })
  }

  const event = JSON.parse(payload) as {
    type?: string
    data?: { object?: { client_reference_id?: string; id?: string } }
  }
  if (event.type !== 'checkout.session.completed') {
    return c.json({ ok: true, ignored: true })
  }

  const paymentId = event.data?.object?.client_reference_id
  if (!paymentId) {
    return c.json({ ok: true, ignored: true })
  }

  const payment = await markPaymentStatus(paymentId, 'paid', event.data?.object?.id)
  return c.json({ ok: true, payment })
})

webhooksRouter.post('/esewa', async (c) => {
  const secret = process.env.ESEWA_SECRET_KEY
  if (!secret) {
    throw new HTTPException(501, { message: 'eSewa is not configured. Set ESEWA_SECRET_KEY.' })
  }

  const body = await c.req.json().catch(() => ({})) as { transaction_uuid?: string; status?: string }
  if (!body.transaction_uuid) {
    throw new HTTPException(400, { message: 'Missing transaction_uuid' })
  }

  const payment = await markPaymentStatus(
    body.transaction_uuid,
    body.status === 'COMPLETE' ? 'paid' : 'failed'
  )
  return c.json({ ok: true, payment })
})

webhooksRouter.post('/paytm', async (c) => {
  if (!process.env.PAYTM_MERCHANT_KEY) {
    throw new HTTPException(501, { message: 'Paytm is not configured. Set PAYTM_MERCHANT_KEY.' })
  }
  const body = await c.req.json().catch(() => ({})) as { ORDERID?: string; STATUS?: string }
  if (!body.ORDERID) {
    throw new HTTPException(400, { message: 'Missing ORDERID' })
  }
  const payment = await markPaymentStatus(body.ORDERID, body.STATUS === 'TXN_SUCCESS' ? 'paid' : 'failed')
  return c.json({ ok: true, payment })
})

webhooksRouter.post('/khalti', async (c) => {
  if (!process.env.KHALTI_SECRET_KEY) {
    throw new HTTPException(501, { message: 'Khalti is not configured. Set KHALTI_SECRET_KEY.' })
  }
  const body = await c.req.json().catch(() => ({})) as { pidx?: string; status?: string; purchase_order_id?: string }
  if (!body.purchase_order_id) {
    throw new HTTPException(400, { message: 'Missing purchase_order_id' })
  }
  const payment = await markPaymentStatus(body.purchase_order_id, body.status === 'Completed' ? 'paid' : 'failed')
  return c.json({ ok: true, payment })
})
