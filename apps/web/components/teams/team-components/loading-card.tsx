/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * loading-card.tsx
 */

'use client'

import * as m from '@/paraglide/messages'
import '../../dashboard/dashboard-kinetic.css'

export function LoadingCard() {
  return (
    <div className='dashboard-kinetic px-3 sm:px-4 lg:px-6'>
      <div className='qx-card p-8'>
        <h1 className='text-2xl font-semibold'>{m['dashboard.teams.title']()}</h1>
        <p className='mt-1 text-sm text-[var(--qx-muted)]'>{m['dashboard.teams.subtitle']()}</p>
        <div className='mt-10 flex flex-col items-center gap-3 py-8'>
          <div className='h-8 w-8 animate-pulse rounded-full bg-[var(--qx-surface-2)]' />
          <p className='text-sm text-[var(--qx-muted)]'>
            {m['dashboard.teams.loadingOrganizationData']()}
          </p>
        </div>
      </div>
    </div>
  )
}
