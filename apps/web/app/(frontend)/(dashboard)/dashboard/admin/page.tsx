/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * page.tsx — Admin Mission Control
 */

'use client'

import { Skeleton } from '@quickxbuild/ui/components/skeleton'
import { AdminConsole } from '@/components/admin/admin-console'
import { useAdminPermissions } from '@/lib/hooks/use-admin-permissions'

export default function AdminPage() {
  const { isPending, user } = useAdminPermissions()

  if (isPending) {
    return (
      <div className='dashboard-kinetic space-y-4 px-3 sm:px-4 lg:px-6'>
        <Skeleton className='h-10 w-64 bg-[var(--qx-surface-2)]' />
        <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4'>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className='h-24 rounded-xl bg-[var(--qx-surface-2)]' />
          ))}
        </div>
        <Skeleton className='h-96 rounded-xl bg-[var(--qx-surface-2)]' />
      </div>
    )
  }

  return (
    <AdminConsole
      adminName={user?.name || ''}
      adminEmail={user?.email || ''}
      adminRole={user?.role || 'admin'}
    />
  )
}
