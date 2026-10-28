export type MailInput = {
  to: string
  subject: string
  text: string
}

export function mailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY || (process.env.SMTP_HOST && process.env.SMTP_USER))
}

/**
 * Send mail via Resend when configured. Otherwise print to the API log.
 */
export async function sendAppMail(input: MailInput): Promise<{ sent: boolean; via: 'resend' | 'log' }> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM || 'noreply@localhost'

  if (apiKey) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: input.to,
        subject: input.subject,
        text: input.text,
      }),
    })
    if (!response.ok) {
      const detail = await response.text()
      console.log(`Mail send failed, falling back to log: ${detail}`)
      console.log(`Email [${input.subject}] to ${input.to}: ${input.text}`)
      return { sent: false, via: 'log' }
    }
    return { sent: true, via: 'resend' }
  }

  console.log(`Email [${input.subject}] to ${input.to}: ${input.text}`)
  return { sent: false, via: 'log' }
}
