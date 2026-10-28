/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * LogoImage.tsx
 * Copyright (C) 2025 Nextify Limited
 */

'use client'

import Image from 'next/image'
import * as m from '@/paraglide/messages'

const LOGO_LIGHT = '/logo.svg'
const LOGO_DARK = '/logo-dark.svg'

type LogoSize = {
  width: number
  height: number
  className: string
}

function LogoFrame({ width, height, className }: LogoSize) {
  return (
    <div className={`flex items-center justify-center bg-transparent ${className}`}>
      <Image
        src={LOGO_LIGHT}
        alt={m['logo.alt']()}
        width={width}
        height={height}
        className='block dark:hidden h-full w-auto object-contain bg-transparent'
        priority
        unoptimized
      />
      <Image
        src={LOGO_DARK}
        alt={m['logo.alt']()}
        width={width}
        height={height}
        className='hidden dark:block h-full w-auto object-contain bg-transparent'
        priority
        unoptimized
      />
    </div>
  )
}

export const Logo = () => (
  <LogoFrame width={176} height={56} className='h-11 w-[176px] sm:h-12' />
)

export const LogoLarge = () => (
  <LogoFrame width={272} height={88} className='h-[88px] w-[272px]' />
)

export const LogoHero = () => (
  <LogoFrame width={210} height={68} className='h-[68px] w-[210px]' />
)
