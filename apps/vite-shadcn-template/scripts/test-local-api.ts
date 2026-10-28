/**
 * Localhost API checklist (no SMTP).
 * Usage: bun scripts/test-local-api.ts
 * Requires the Node API on :8787 and a migrated APP_SCHEMA.
 */

const BASE = process.env.APP_API_URL || 'http://127.0.0.1:8787'
const stamp = Date.now()

type CookieJar = { cookie: string }

function readSetCookie(response: Response, jar: CookieJar) {
  const raw = response.headers.getSetCookie?.() || []
  const session = raw.find((value) => value.startsWith('app_session='))
  if (session) {
    jar.cookie = session.split(';')[0]
  }
}

async function request(
  path: string,
  init: RequestInit = {},
  jar?: CookieJar
): Promise<{ status: number; data: any; response: Response }> {
  const headers = new Headers(init.headers)
  if (jar?.cookie) {
    headers.set('Cookie', jar.cookie)
  }
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(`${BASE}${path}`, { ...init, headers })
  if (jar) {
    readSetCookie(response, jar)
  }

  const text = await response.text()
  let data: any = text
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = { raw: text }
  }
  return { status: response.status, data, response }
}

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message)
  }
}

async function main() {
  const failures: string[] = []
  const check = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn()
      console.log(`ok  ${name}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push(`${name}: ${message}`)
      console.error(`fail ${name}: ${message}`)
    }
  }

  await check('health', async () => {
    const { status, data } = await request('/api/health')
    assert(status === 200 && data.ok === true, `unexpected health ${status} ${JSON.stringify(data)}`)
    assert(typeof data.schema === 'string', 'health missing schema')
  })

  const admin = { cookie: '' }
  await check('admin login', async () => {
    const { status, data } = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@local.dev', password: 'admin1234' }),
    }, admin)
    assert(status === 200 && data.user?.role === 'owner', `admin login failed ${status}`)
    assert(admin.cookie.startsWith('app_session='), 'missing session cookie')
  })

  await check('oauth status + redirect routes exist', async () => {
    const statusRes = await request('/api/auth/oauth')
    assert(statusRes.status === 200, 'oauth status missing')
    assert('google' in statusRes.data && 'github' in statusRes.data, 'oauth status shape')

    const google = await request('/api/auth/google', { redirect: 'manual' })
    const github = await request('/api/auth/github', { redirect: 'manual' })
    const googleOk = google.status === 302 || google.status === 501
    const githubOk = github.status === 302 || github.status === 501
    assert(googleOk && githubOk, `oauth start status google=${google.status} github=${github.status}`)
  })

  let inviteToken = ''
  await check('admin invite', async () => {
    const email = `invite-${stamp}@local.dev`
    const { status, data } = await request('/api/admin/invites', {
      method: 'POST',
      body: JSON.stringify({ email, role: 'admin' }),
    }, admin)
    assert(status === 201 && data.invite?.token, `invite failed ${status} ${JSON.stringify(data)}`)
    assert(String(data.url).includes('/signup?invite='), 'invite url missing')
    inviteToken = data.invite.token
  })

  const member = { cookie: '' }
  await check('signup with invite token', async () => {
    const email = `invite-${stamp}@local.dev`
    const { status, data } = await request('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({
        email,
        password: 'password123',
        name: 'Invite User',
        inviteToken,
      }),
    }, member)
    assert(status === 201 && data.user?.role === 'admin', `invite signup failed ${status} ${JSON.stringify(data)}`)
  })

  await check('item create', async () => {
    const { status, data } = await request('/api/items', {
      method: 'POST',
      body: JSON.stringify({ title: `Note ${stamp}`, body: 'localhost checklist' }),
    }, member)
    assert(status === 201 && data.item?.id, `item create failed ${status}`)
  })

  await check('file upload', async () => {
    const form = new FormData()
    form.append('file', new File(['hello from localhost'], 'note.txt', { type: 'text/plain' }))
    const { status, data } = await request('/api/files', { method: 'POST', body: form }, member)
    assert(status === 201 && data.file?.id && data.file.path, `upload failed ${status} ${JSON.stringify(data)}`)

    const served = await request(`/api/files/${data.file.id}`, {}, member)
    assert(served.status === 200, `file serve failed ${served.status}`)
  })

  await check('admin integrations status', async () => {
    const { status, data } = await request('/api/admin/integrations', {}, admin)
    assert(status === 200 && data.integrations, `integrations failed ${status}`)
    assert(data.integrations.stripe === false || data.integrations.stripe === true, 'stripe flag missing')
  })

  await check('stripe checkout without keys', async () => {
    const { status, data } = await request('/api/payments/checkout', {
      method: 'POST',
      body: JSON.stringify({ amount: 500, description: 'checklist', provider: 'stripe' }),
    }, member)
    assert(status === 501 || status === 200, `checkout status ${status} ${JSON.stringify(data)}`)
    if (status === 501) {
      assert(String(data.error || '').toLowerCase().includes('stripe'), 'expected stripe 501 message')
    }
  })

  await check('esewa checkout without keys', async () => {
    const { status, data } = await request('/api/payments/checkout', {
      method: 'POST',
      body: JSON.stringify({ amount: 500, description: 'checklist', provider: 'esewa' }),
    }, member)
    assert(status === 501 || status === 200, `esewa status ${status}`)
    if (status === 501) {
      assert(String(data.error || '').toLowerCase().includes('esewa'), 'expected esewa 501 message')
    }
  })

  await check('stripe webhook without secret or signature', async () => {
    const { status } = await request('/api/webhooks/stripe', {
      method: 'POST',
      body: JSON.stringify({ type: 'checkout.session.completed' }),
    })
    assert(status === 501 || status === 400, `webhook status ${status}`)
  })

  await check('mail log fallback', async () => {
    const { status, data } = await request('/api/mail/test', {
      method: 'POST',
      body: JSON.stringify({ to: 'admin@local.dev', subject: 'checklist', text: 'hello' }),
    }, admin)
    assert(status === 200 && (data.via === 'log' || data.via === 'resend'), `mail ${status} ${JSON.stringify(data)}`)
  })

  await check('paytm checkout without keys', async () => {
    const { status, data } = await request('/api/payments/checkout', {
      method: 'POST',
      body: JSON.stringify({ amount: 500, provider: 'paytm' }),
    }, member)
    assert(status === 501 || status === 200, `paytm ${status}`)
    if (status === 501) {
      assert(String(data.error || '').toLowerCase().includes('paytm'), 'expected paytm 501')
    }
  })

  await check('khalti checkout without keys', async () => {
    const { status, data } = await request('/api/payments/checkout', {
      method: 'POST',
      body: JSON.stringify({ amount: 500, provider: 'khalti' }),
    }, member)
    assert(status === 501 || status === 200, `khalti ${status}`)
    if (status === 501) {
      assert(String(data.error || '').toLowerCase().includes('khalti'), 'expected khalti 501')
    }
  })

  await check('product, unpaid order, analytics', async () => {
    const sku = `sku-${stamp}`
    const created = await request('/api/products', {
      method: 'POST',
      body: JSON.stringify({ name: 'Tee', sku, price: 1999, cost: 800, stock: 5 }),
    }, admin)
    assert(created.status === 201 && created.data.product?.id, `product ${created.status} ${JSON.stringify(created.data)}`)
    const ordered = await request('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ items: [{ productId: created.data.product.id, qty: 1 }] }),
    }, member)
    assert(ordered.status === 201 && ordered.data.order?.status === 'unpaid', `order ${ordered.status}`)
    const analytics = await request('/api/admin/analytics', {}, admin)
    assert(analytics.status === 200 && typeof analytics.data.revenue === 'number', 'analytics missing')
    assert(analytics.data.today && analytics.data.week && analytics.data.month, 'period analytics missing')
    const suggested = await request('/api/admin/suggested-tables?kind=shop', {}, admin)
    assert(suggested.status === 200 && suggested.data.tables?.includes('products'), 'suggested tables missing')
  })

  await check('refund unknown payment is 404', async () => {
    const { status } = await request('/api/payments/not-a-real-payment/refund', { method: 'POST' }, admin)
    assert(status === 404, `expected refund 404 got ${status}`)
  })

  await check('admin schema row counts', async () => {
    const { status, data } = await request('/api/admin/schema', {}, admin)
    assert(status === 200 && data.tables?.users >= 1, `schema view failed ${status} ${JSON.stringify(data)}`)
    assert(data.tables?.files >= 1 && data.tables?.items >= 1, 'expected files and items rows')
  })

  console.log('\nManual: open /dashboard in two tabs and confirm items:changed without refresh.')

  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed`)
    process.exit(1)
  }
  console.log('\nAll localhost API checks passed.')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
