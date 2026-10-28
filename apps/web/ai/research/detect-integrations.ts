export type DetectedProvider = {
  id: string
  officialHosts: string[]
}

const PROVIDERS: Array<{
  id: string
  keywords: string[]
  officialHosts: string[]
}> = [
  { id: 'stripe', keywords: ['stripe', 'payment intent', 'checkout session'], officialHosts: ['stripe.com', 'docs.stripe.com'] },
  { id: 'esewa', keywords: ['esewa', 'e-sewa', 'e sewa'], officialHosts: ['developer.esewa.com.np', 'esewa.com.np'] },
  { id: 'paytm', keywords: ['paytm', 'phonepe', 'upi'], officialHosts: ['business.paytm.com', 'developer.paytm.com'] },
  { id: 'khalti', keywords: ['khalti'], officialHosts: ['docs.khalti.com', 'khalti.com'] },
  { id: 'razorpay', keywords: ['razorpay'], officialHosts: ['razorpay.com'] },
  { id: 'resend', keywords: ['resend'], officialHosts: ['resend.com'] },
  { id: 'smtp', keywords: ['smtp', 'nodemailer', 'sendgrid', 'transactional email'], officialHosts: ['resend.com', 'nodemailer.com'] },
  { id: 'email', keywords: ['send email', 'email receipt', 'order confirmation', 'password reset email'], officialHosts: ['resend.com'] },
  { id: 'oauth', keywords: ['oauth', 'google login', 'github login'], officialHosts: ['developers.google.com', 'docs.github.com'] },
  { id: 's3', keywords: ['s3', 'r2 bucket', 'object storage'], officialHosts: ['docs.aws.amazon.com', 'developers.cloudflare.com'] },
  { id: 'maps', keywords: ['mapbox', 'google maps', 'leaflet'], officialHosts: ['docs.mapbox.com', 'developers.google.com'] },
]

const GENERIC_TRIGGERS = [
  'checkout',
  'payment',
  'webhook',
  'smtp',
  'stripe',
  'esewa',
  'paytm',
  'khalti',
  'razorpay',
  'invoice',
  'merchant',
]

/**
 * Cheap keyword pass. Skip OpenAI search for pure UI tweaks.
 */
export function detectIntegrations(prompt: string): DetectedProvider[] {
  const text = prompt.toLowerCase()
  const found = new Map<string, DetectedProvider>()

  for (const provider of PROVIDERS) {
    if (provider.keywords.some((keyword) => text.includes(keyword))) {
      found.set(provider.id, { id: provider.id, officialHosts: provider.officialHosts })
    }
  }

  return [...found.values()]
}

export function needsDocsSearch(prompt: string, isFileEdit = false): boolean {
  if (isFileEdit) {
    return false
  }

  if (detectIntegrations(prompt).length > 0) {
    return true
  }

  const text = prompt.toLowerCase()
  return GENERIC_TRIGGERS.some((trigger) => text.includes(trigger))
}

export function preferredHosts(providers: DetectedProvider[]): string[] {
  return [...new Set(providers.flatMap((provider) => provider.officialHosts))]
}
