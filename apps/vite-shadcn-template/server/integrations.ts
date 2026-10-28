export function integrationStatus() {
  return {
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    github: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
    stripe: Boolean(process.env.STRIPE_SECRET_KEY),
    stripeWebhook: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
    resend: Boolean(process.env.RESEND_API_KEY),
    smtp: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER),
    esewa: Boolean(process.env.ESEWA_PRODUCT_CODE && process.env.ESEWA_SECRET_KEY),
    paytm: Boolean(process.env.PAYTM_MID && process.env.PAYTM_MERCHANT_KEY),
    khalti: Boolean(process.env.KHALTI_SECRET_KEY),
  }
}
