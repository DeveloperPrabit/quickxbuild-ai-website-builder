/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Contact form → Resend notification to platform owner
 */

import { sendContactFormNotification } from '@quickxbuild/email'
import { NextResponse } from 'next/server'
import { z } from 'zod/v4'

/** Owner inbox for sales / contact submissions */
const CONTACT_RECIPIENT =
  process.env.CONTACT_TO_EMAIL || 'prabitjoshi@gmail.com'

export type ContactBody = z.infer<typeof ContactBody>
const ContactBody = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.email().max(254),
  company: z.string().trim().max(160).optional(),
  message: z.string().trim().min(1).max(5000),
})

export async function POST(request: Request) {
  try {
    const json = await request.json()
    const parsed = ContactBody.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'Invalid form data' },
        { status: 400 }
      )
    }

    const { name, email, company, message } = parsed.data
    const fullMessage = company
      ? `Company: ${company}\n\n${message}`
      : message

    await sendContactFormNotification({
      name,
      email,
      message: fullMessage,
      recipientEmail: CONTACT_RECIPIENT,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[contact] Failed to send contact form email:', error)
    return NextResponse.json(
      { ok: false, error: 'Failed to send message. Please try again.' },
      { status: 500 }
    )
  }
}
