/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * BrandMark.tsx — crisp coral QuickXBuild mark (vector; no photo tear / halo)
 */

'use client'

import { cn } from '@quickxbuild/ui/lib/utils'

type BrandMarkProps = {
  className?: string
  title?: string
}

/**
 * Coral rounded-square + precise Q. Fill matches Obsidian Kinetic canvas (#131315)
 * so edges stay crisp on the dashboard — no photographic halo or “torn” fringe.
 */
export function BrandMark({ className, title = 'QuickXBuild' }: BrandMarkProps) {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      viewBox='0 0 128 128'
      role='img'
      aria-label={title}
      className={cn('shrink-0 rounded-[22%]', className)}
    >
      <title>{title}</title>
      <rect width='128' height='128' rx='28' fill='#FF7347' />
      <path
        fill='#131315'
        d='M64 28c-19.882 0-36 16.118-36 36 0 19.882 16.118 36 36 36 8.284 0 15.922-2.8 22.02-7.52l10.74 10.74a6 6 0 0 0 8.486-8.486l-10.48-10.48C99.02 77.38 102 69.04 102 64c0-19.882-16.118-36-36-36Zm0 14c12.15 0 22 9.85 22 22s-9.85 22-22 22-22-9.85-22-22 9.85-22 22-22Z'
      />
      <path d='M86 86l16 16' stroke='#131315' strokeWidth='10' strokeLinecap='round' />
    </svg>
  )
}
