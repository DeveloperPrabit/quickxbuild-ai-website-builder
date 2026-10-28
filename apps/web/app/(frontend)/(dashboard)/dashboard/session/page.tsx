/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * page.tsx — Session Management
 */

import { initAuth } from '@quickxbuild/auth/auth-server'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { api } from '@/trpc/server'
import { SessionManagement } from '@/components/dashboard/session-management'

export default async function SessionPage() {
  const auth = await initAuth()
  const headersList = await headers()
  const sessionData = await auth.api.getSession({
    headers: headersList,
  })
  const user = sessionData?.user
  const currentSessionId = sessionData?.session?.id || ''

  if (!user) {
    redirect('/')
  }

  const sessions = await api.session.list({})

  return (
    <SessionManagement
      sessions={sessions as any}
      currentSessionId={currentSessionId}
    />
  )
}
