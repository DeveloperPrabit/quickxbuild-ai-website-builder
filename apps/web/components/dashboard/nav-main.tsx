/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * nav-main.tsx — Obsidian Kinetic sidebar sections (DESIGN mock)
 */

'use client'

import type { LucideIcon } from 'lucide-react'
import { Plus } from 'lucide-react'
import * as React from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@quickxbuild/ui/components/sidebar'
import { CreateProjectDialog } from './create-project-dialog'
import { cn } from '@quickxbuild/ui/lib/utils'
import * as m from '@/paraglide/messages'

export type NavItem = {
  title: string
  url: string
  icon: LucideIcon
  /** Show a live notification pip on the right */
  badgeDot?: boolean
  /** Match ?tab= when on /dashboard */
  tab?: string
}

export type NavSection = {
  label: string
  items: NavItem[]
}

function isItemActive(pathname: string, searchTab: string | null, item: NavItem) {
  if (item.tab) {
    if (pathname !== '/dashboard') return false
    const current = searchTab || 'overview'
    return current === item.tab
  }
  if (item.url === '/dashboard') {
    return pathname === '/dashboard' && (!searchTab || searchTab === 'overview')
  }
  return pathname === item.url || pathname.startsWith(`${item.url}/`)
}

export function NavMain({ sections }: { sections: NavSection[] }) {
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const searchTab = searchParams.get('tab')

  return (
    <>
      <SidebarGroup className='px-2 pt-1'>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip={m['dashboard.create_project']()}
                onClick={() => setDialogOpen(true)}
                className={cn(
                  'h-10 w-full justify-center rounded-full',
                  'bg-[#FF7347] text-[#131315] font-semibold',
                  'hover:bg-[#f97316] hover:text-[#131315]',
                  'active:bg-[#ea580c] active:text-[#131315]',
                  'shadow-none'
                )}
              >
                <Plus className='size-4 stroke-[2.5]' />
                <span>{m['dashboard.create_project']()}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      {sections.map((section) => (
        <SidebarGroup key={section.label} className='px-2 py-1'>
          <SidebarGroupLabel className='mb-1 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--qx-muted,#71717a)]'>
            {section.label}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className='gap-0.5'>
              {section.items.map((item) => {
                const active = isItemActive(pathname, searchTab, item)
                const Icon = item.icon
                return (
                  <SidebarMenuItem key={`${section.label}-${item.title}`}>
                    <SidebarMenuButton
                      asChild
                      tooltip={item.title}
                      isActive={active}
                      className={cn(
                        'h-9 rounded-lg px-2.5 text-[13px] font-medium duration-150',
                        'text-[rgba(237,237,237,0.88)] hover:bg-[rgba(255,255,255,0.05)] hover:text-[var(--qx-text,#ededed)]',
                        active &&
                          'bg-[rgba(255,115,71,0.12)] text-[#FF7347] hover:bg-[rgba(255,115,71,0.16)] hover:text-[#FF7347] data-[active=true]:bg-[rgba(255,115,71,0.12)] data-[active=true]:text-[#FF7347]'
                      )}
                    >
                      <Link href={item.url} className='flex w-full items-center gap-2.5'>
                        <Icon
                          className={cn(
                            'size-4 shrink-0',
                            active ? 'text-[#FF7347]' : 'text-[rgba(237,237,237,0.7)]'
                          )}
                        />
                        <span className='flex-1 truncate'>{item.title}</span>
                        {item.badgeDot ? (
                          <span
                            className='ml-auto size-1.5 shrink-0 rounded-full bg-[#38bdf8] shadow-[0_0_6px_rgba(56,189,248,0.8)]'
                            aria-hidden
                          />
                        ) : null}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}

      <CreateProjectDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  )
}
