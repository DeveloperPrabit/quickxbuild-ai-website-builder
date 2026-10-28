/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * page.tsx
 * Copyright (C) 2025 Nextify Limited
 */

import { Suspense } from 'react'
import { CommandCenter } from '@/components/dashboard/command-center'

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className='px-6 py-8 text-sm text-muted-foreground'>Loading command center…</div>}>
      <CommandCenter />
    </Suspense>
  )
}
