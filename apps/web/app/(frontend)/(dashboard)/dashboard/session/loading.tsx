/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * loading.tsx
 */

export default function Loading() {
  return (
    <div className='dashboard-kinetic space-y-4 px-3 sm:px-4 lg:px-6'>
      <div className='h-28 animate-pulse rounded-xl bg-[var(--qx-surface,#1c1c1f)]' />
      <div className='h-16 animate-pulse rounded-xl bg-[var(--qx-surface,#1c1c1f)]' />
      <div className='h-64 animate-pulse rounded-xl bg-[var(--qx-surface,#1c1c1f)]' />
      <div className='h-40 animate-pulse rounded-xl bg-[var(--qx-surface,#1c1c1f)]' />
    </div>
  )
}
