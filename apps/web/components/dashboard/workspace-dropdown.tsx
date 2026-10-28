/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * workspace-dropdown.tsx
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

import { cn } from '@quickxbuild/ui/lib/utils'
import { ChevronsUpDown } from 'lucide-react'
import * as React from 'react'
import type { LucideIcon } from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@quickxbuild/ui/components/dropdown-menu'
import { Button } from '@quickxbuild/ui/components/button'
import { CheckIcon, Crown, PlusCircle, Sparkles } from 'lucide-react'

import type { TeamProps } from './workspace-utils'
import * as m from '@/paraglide/messages'

type PlanType = 'FREE' | 'PRO' | 'MAX' | 'ENTERPRISE'

const PLAN_STYLES: Record<
  PlanType,
  {
    color: string
    gradientFrom: string
    gradientTo: string
    badge: string
    icon: LucideIcon
  }
> = {
  FREE: {
    color: 'text-[var(--qx-muted,#a1a1aa)]',
    gradientFrom: 'from-zinc-400',
    gradientTo: 'to-zinc-600',
    badge: 'bg-[rgba(161,161,170,0.15)] text-[var(--qx-muted,#a1a1aa)]',
    icon: Sparkles,
  },
  PRO: {
    color: 'text-[#38bdf8]',
    gradientFrom: 'from-sky-400',
    gradientTo: 'to-sky-600',
    badge: 'bg-[rgba(56,189,248,0.18)] text-[#38bdf8]',
    icon: Crown,
  },
  MAX: {
    color: 'text-[#38bdf8]',
    gradientFrom: 'from-sky-400',
    gradientTo: 'to-indigo-500',
    badge: 'bg-[rgba(56,189,248,0.2)] text-[#38bdf8] uppercase tracking-wide',
    icon: Crown,
  },
  ENTERPRISE: {
    color: 'text-[#38bdf8]',
    gradientFrom: 'from-sky-400',
    gradientTo: 'to-indigo-500',
    badge: 'bg-[rgba(56,189,248,0.2)] text-[#38bdf8] uppercase tracking-wide',
    icon: Crown,
  },
}

const renderPlanIcon = (Icon: LucideIcon, className?: string) => {
  return React.createElement(Icon, { className: className || 'size-4' })
}

const renderLogo = (LogoComponent: React.ElementType, className?: string) => {
  return React.createElement(LogoComponent, { className: className || 'size-4' })
}

interface WorkspaceDropdownProps {
  teams: TeamProps[]
  activeTeam: TeamProps | null
  onTeamChange: (team: TeamProps) => void
  onCreateWorkspace: () => void
  isChanging: boolean
  isMobile: boolean
}

export function WorkspaceDropdown({
  teams,
  activeTeam,
  onTeamChange,
  onCreateWorkspace,
  isChanging,
  isMobile,
}: WorkspaceDropdownProps) {
  if (!activeTeam) return null

  const getPlanStyle = (plan: string) => {
    const planKey = (plan || 'FREE') as PlanType
    return PLAN_STYLES[planKey] || PLAN_STYLES.FREE
  }

  const activeTeamPlanStyle = getPlanStyle(activeTeam.plan || 'FREE')

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant='ghost'
          size='sm'
          className='h-9 w-full justify-between px-2 text-[var(--qx-text,#ededed)] hover:bg-[rgba(255,255,255,0.05)]'
          disabled={isChanging}
        >
          <div className='flex max-w-[150px] items-center gap-1.5 sm:max-w-[180px] sm:gap-2'>
            <div className='flex-shrink-0 overflow-hidden rounded-md'>
              {activeTeam.logo ? (
                renderLogo(activeTeam.logo, 'size-6')
              ) : (
                <div className='flex size-6 items-center justify-center rounded-md bg-[#FF7347] text-xs font-medium text-[#131315]'>
                  {activeTeam.name.substring(0, 2).toUpperCase()}
                </div>
              )}
            </div>
            <div className='flex min-w-0 flex-col items-start leading-none'>
              <span className='line-clamp-1 w-full truncate text-xs font-medium sm:text-sm'>
                {activeTeam.name}
              </span>
              <div className='flex items-center gap-1'>
                <span
                  className={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium ${activeTeamPlanStyle.badge}`}
                >
                  {renderPlanIcon(activeTeamPlanStyle.icon, 'size-2.5')}
                  <span>{activeTeam.plan || 'FREE'}</span>
                </span>
              </div>
            </div>
          </div>
          <ChevronsUpDown className='size-4 text-[var(--qx-muted,#a1a1aa)] opacity-50' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={isMobile ? 'center' : 'start'}
        side='right'
        className='max-h-[50vh] w-56 overflow-auto border-[var(--qx-border,rgba(255,255,255,0.08))] bg-[var(--qx-surface,#1c1c1f)] sm:w-64'
      >
        <DropdownMenuRadioGroup
          value={activeTeam.id}
          onValueChange={(value) => {
            const team = teams.find((t) => t.id === value)
            if (team) {
              onTeamChange(team)
            }
          }}
        >
          {teams.map((team) => {
            const planStyle = getPlanStyle(team.plan || 'FREE')
            const isActive = team.id === activeTeam.id
            const activeClass = isActive
              ? `bg-gradient-to-r ${planStyle.gradientFrom}/10 ${planStyle.gradientTo}/10`
              : ''

            return (
              <DropdownMenuRadioItem
                key={team.id}
                value={team.id}
                className={cn('cursor-pointer px-3 py-2 focus:bg-accent/80', activeClass)}
              >
                <div className='flex max-w-[180px] items-center gap-1.5 sm:max-w-[210px] sm:gap-2'>
                  <div className='flex-shrink-0 overflow-hidden rounded-md'>
                    {team.logo ? (
                      renderLogo(team.logo, 'size-6')
                    ) : (
                      <div className='flex size-6 items-center justify-center rounded-md bg-[#FF7347] text-xs font-medium text-[#131315]'>
                        {team.name.substring(0, 2).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className='flex min-w-0 flex-col items-start leading-none'>
                    <div className='flex items-center gap-1'>
                      <span className='line-clamp-1 w-full truncate text-xs font-medium sm:text-sm'>
                        {team.name}
                      </span>
                      {isActive && <CheckIcon className='ml-1 size-3.5 text-[#FF7347]' />}
                    </div>

                    <div className='mt-1 flex items-center'>
                      <span
                        className={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium ${planStyle.badge}`}
                      >
                        {renderPlanIcon(planStyle.icon, 'size-2.5')}
                        <span>{team.plan || 'FREE'}</span>
                      </span>
                    </div>
                  </div>
                </div>
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem className='cursor-pointer gap-2 py-1.5' onClick={onCreateWorkspace}>
          <PlusCircle className='size-4 text-muted-foreground' />
          <span>{m['dashboard.workspace.create.createNew']()}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
