import { describe, expect, test } from 'vitest'
import { failedBrief, formatBriefXml, parseIntegrationBrief, sanitizeBrief, stripSecrets } from '../research/brief'
import { detectIntegrations, needsDocsSearch } from '../research/detect-integrations'

describe('detectIntegrations', () => {
  test('skips search for UI-only prompts and file edits', () => {
    expect(needsDocsSearch('make the header blue')).toBe(false)
    expect(needsDocsSearch('Add Stripe Checkout', true)).toBe(false)
  })

  test('detects stripe, esewa, and email', () => {
    expect(detectIntegrations('Add Stripe Checkout for clothing orders').map((item) => item.id)).toContain('stripe')
    expect(detectIntegrations('Pay with eSewa in Nepal').map((item) => item.id)).toContain('esewa')
    expect(needsDocsSearch('Send order confirmation email via Resend')).toBe(true)
    expect(detectIntegrations('Add Khalti checkout').map((item) => item.id)).toContain('khalti')
  })
})

describe('IntegrationBrief', () => {
  test('strips live-looking secrets', () => {
    expect(stripSecrets('use sk_test_51ABCSECRET and Bearer abcdefghijklmnopqr')).toContain('[REDACTED]')
    const brief = sanitizeBrief({
      summary: 'ok sk_live_12345',
      providers: [{
        id: 'stripe',
        official: true,
        urls: ['https://docs.stripe.com'],
        endpoints: [],
        envNames: ['STRIPE_SECRET_KEY', 'STRIPE_SECRET_KEY=sk_test_xxx'],
        pitfalls: [],
      }],
      constraints: [],
    })
    expect(brief.summary).not.toContain('sk_live_')
    expect(brief.providers[0]?.envNames).toEqual(['STRIPE_SECRET_KEY'])
  })

  test('parses fenced JSON and formats user prompt docs', () => {
    const parsed = parseIntegrationBrief(`here
\`\`\`json
{"summary":"Stripe checkout","providers":[{"id":"stripe","official":true,"urls":["https://docs.stripe.com/payments/checkout"],"endpoints":[{"method":"POST","path":"/v1/checkout/sessions","purpose":"create session"}],"envNames":["STRIPE_SECRET_KEY"],"pitfalls":["verify webhooks"]}],"constraints":["env names only"]}
\`\`\``)
    expect(parsed?.providers[0]?.id).toBe('stripe')
    expect(formatBriefXml(parsed!)).toContain('<integrationDocs>')
    expect(formatBriefXml(parsed!)).toContain('STRIPE_SECRET_KEY')
  })

  test('failed brief stays fail-open', () => {
    const brief = failedBrief('timeout', ['stripe'])
    expect(brief.warning).toBe('timeout')
    expect(brief.providers[0]?.official).toBe(false)
  })
})
