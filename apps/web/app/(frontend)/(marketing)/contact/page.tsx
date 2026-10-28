/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * page.tsx
 * Copyright (C) 2025 Nextify Limited
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 */

import { ContactForm } from '@/components/marketing/contact/contact-form'
import Navbar from '@/components/marketing/nav'
import * as m from '@/paraglide/messages'
import { initAuth } from '@quickxbuild/auth/auth-server'
import { Section } from '@quickxbuild/ui/components/section'
import { headers } from 'next/headers'

export default async function ContactPage() {
  let isAuthenticated = false
  try {
    const auth = await initAuth()
    const headersList = await headers()
    const session = await auth.api.getSession({
      headers: headersList,
    })
    isAuthenticated = !!session?.user
  } catch {
    isAuthenticated = false
  }

  return (
    <main className='min-h-screen w-full overflow-hidden bg-[var(--background-landing)] text-[var(--foreground-landing)]'>
      <Navbar isAuthenticated={isAuthenticated} />
      <Section className='py-16'>
        <div className='mx-auto flex max-w-5xl flex-col gap-8 px-4 md:px-6'>
          <div className='flex flex-col gap-4 text-center'>
            <h1 className='text-4xl font-bold leading-tight sm:text-5xl'>{m['contact.page_title']()}</h1>
            <p className='text-muted-foreground mx-auto max-w-[700px] text-lg'>
              {m['contact.page_description']()}
            </p>
          </div>

          <div className='grid grid-cols-1 gap-12 md:grid-cols-5 lg:gap-16'>
            <div className='md:col-span-3'>
              <ContactForm />
            </div>
            <div className='flex flex-col gap-8 md:col-span-2'>
              <div className='glass-1 flex flex-col gap-4 rounded-2xl p-8 shadow-lg'>
                <h3 className='text-xl font-semibold'>{m['contact.enterprise_title']()}</h3>
                <ul className='flex flex-col gap-2'>
                  <li className='flex items-start gap-2'>
                    <div className='text-brand h-5 w-5 shrink-0'>•</div>
                    <span>{m['contact.enterprise_support']()}</span>
                  </li>
                  <li className='flex items-start gap-2'>
                    <div className='text-brand h-5 w-5 shrink-0'>•</div>
                    <span>{m['contact.enterprise_deployment']()}</span>
                  </li>
                  <li className='flex items-start gap-2'>
                    <div className='text-brand h-5 w-5 shrink-0'>•</div>
                    <span>{m['contact.enterprise_sso']()}</span>
                  </li>
                  <li className='flex items-start gap-2'>
                    <div className='text-brand h-5 w-5 shrink-0'>•</div>
                    <span>{m['contact.enterprise_security']()}</span>
                  </li>
                  <li className='flex items-start gap-2'>
                    <div className='text-brand h-5 w-5 shrink-0'>•</div>
                    <span>{m['contact.enterprise_training']()}</span>
                  </li>
                </ul>
              </div>

              <div className='glass-1 flex flex-col gap-4 rounded-2xl p-8 shadow-lg'>
                <h3 className='text-xl font-semibold'>{m['contact.other_contact_title']()}</h3>
                <div className='flex flex-col gap-4'>
                  <div>
                    <p className='font-medium'>{m['contact.customer_support']()}</p>
                    <p className='text-muted-foreground'>{m['contact.customer_support_email']()}</p>
                  </div>
                  <div>
                    <p className='font-medium'>{m['contact.business_cooperation']()}</p>
                    <p className='text-muted-foreground'>{m['contact.business_cooperation_email']()}</p>
                  </div>
                  <div>
                    <p className='font-medium'>{m['contact.media_inquiry']()}</p>
                    <p className='text-muted-foreground'>{m['contact.media_inquiry_email']()}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Section>
    </main>
  )
}
