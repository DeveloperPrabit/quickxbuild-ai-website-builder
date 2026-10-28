/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * site-header.tsx
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

'use client'

import { ThemeSwitcher } from '@/components/common/theme-switcher'
import { Separator } from '@quickxbuild/ui/components/separator'
import { SidebarTrigger } from '@quickxbuild/ui/components/sidebar'
import { Search } from 'lucide-react'
import * as m from '@/paraglide/messages'

export function SiteHeader() {
  return (
    <header className='group-has-data-[collapsible=icon]/sidebar-wrapper:h-12 flex h-12 shrink-0 items-center gap-2 border-b border-[var(--qx-border,rgba(255,255,255,0.08))] bg-[var(--qx-bg,#131315)] transition-[width,height] ease-linear'>
      <div className='flex w-full items-center justify-between gap-3 px-3 sm:px-4 lg:px-6'>
        <div className='flex min-w-0 items-center gap-1 lg:gap-2'>
          <SidebarTrigger className='-ml-1 text-[var(--qx-text,#ededed)]' />
          <Separator
            orientation='vertical'
            className='mx-2 data-[orientation=vertical]:h-4 bg-[var(--qx-border,rgba(255,255,255,0.08))]'
          />
          <nav className='flex min-w-0 items-center gap-1.5 text-sm'>
            <span className='hidden truncate text-[var(--qx-muted,#a1a1aa)] sm:inline'>
              {m['dashboard.siteHeader.projectManagement']()}
            </span>
            <span className='hidden text-[var(--qx-muted,#a1a1aa)] sm:inline'>/</span>
            <h1 className='truncate font-medium text-[var(--qx-text,#ededed)]'>
              AI Autonomous Suite
            </h1>
          </nav>
        </div>

        <div className='hidden max-w-xs flex-1 md:flex lg:max-w-sm'>
          <label className='relative flex w-full items-center'>
            <Search className='pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-[var(--qx-muted,#a1a1aa)]' />
            <input
              type='search'
              placeholder='Search projects, models, agents…'
              className='h-8 w-full rounded-lg border border-[var(--qx-border,rgba(255,255,255,0.08))] bg-[var(--qx-surface,#1c1c1f)] py-1.5 pr-3 pl-8 text-xs text-[var(--qx-text,#ededed)] outline-none placeholder:text-[var(--qx-muted,#a1a1aa)] focus:border-[rgba(255,115,71,0.45)]'
              readOnly
              aria-label='Search workflows and agents'
            />
          </label>
        </div>

        <div className='flex shrink-0 items-center gap-1 sm:gap-2'>
          <span className='qx-pill qx-pill-live hidden lg:inline-flex'>
            <span className='qx-live-dot' />
            All Systems Live 99.98%
          </span>
          <ThemeSwitcher />
        </div>
      </div>
    </header>
  )
}
