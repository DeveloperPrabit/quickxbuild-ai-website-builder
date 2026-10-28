/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * columns.tsx — Mission Control user table columns
 */

'use client'

import type { ColumnDef } from '@tanstack/react-table'
import { format, formatDistanceToNow } from 'date-fns'
import { ArrowUpDown, CheckCircle2, Clock3, MoreHorizontal, Shield } from 'lucide-react'

import * as m from '@/paraglide/messages'

import { Button } from '@quickxbuild/ui/components/button'
import { Avatar, AvatarFallback, AvatarImage } from '@quickxbuild/ui/components/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@quickxbuild/ui/components/dropdown-menu'
import { cn } from '@quickxbuild/ui/lib/utils'

import type { AdminUser } from '@/lib/types/admin'
import { UserActions } from './user-actions'

function roleBadge(role?: string) {
  const r = (role || 'user').toLowerCase()
  if (r === 'superadmin') {
    return {
      label: 'Superadmin',
      className: 'bg-[rgba(255,115,71,0.18)] text-[#FF7347]',
    }
  }
  if (r === 'admin') {
    return {
      label: 'Admin',
      className: 'bg-[rgba(168,85,247,0.18)] text-[#c084fc]',
    }
  }
  if (r === 'developer') {
    return {
      label: 'Developer',
      className: 'bg-[rgba(56,189,248,0.18)] text-[#38bdf8]',
    }
  }
  return {
    label: r === 'user' ? 'Member' : role || 'Member',
    className: 'bg-[rgba(161,161,170,0.15)] text-[#a1a1aa]',
  }
}

function avatarTone(seed: string) {
  const tones = [
    'bg-[#FF7347]/20 text-[#FF7347]',
    'bg-[#38bdf8]/20 text-[#38bdf8]',
    'bg-[#a78bfa]/20 text-[#c4b5fd]',
    'bg-[#22c55e]/20 text-[#4ade80]',
    'bg-[#eab308]/20 text-[#facc15]',
  ]
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash + seed.charCodeAt(i) * (i + 1)) % tones.length
  return tones[hash] || tones[0]
}

export function createColumns(refetch: () => void): ColumnDef<AdminUser>[] {
  return [
    {
      accessorKey: 'name',
      header: ({ column }) => (
        <Button
          variant='ghost'
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          className='h-auto p-0 font-medium text-[var(--qx-muted)] hover:text-[var(--qx-text)]'
        >
          User Info
          <ArrowUpDown className='ml-2 h-4 w-4' />
        </Button>
      ),
      cell: ({ row }) => {
        const user = row.original
        const initials =
          user.name?.slice(0, 2).toUpperCase() || user.email?.slice(0, 2).toUpperCase() || 'U'
        const shortId = `USR-${user.id.slice(-4).toUpperCase()}`
        return (
          <div className='flex items-center gap-3'>
            <Avatar className='h-9 w-9'>
              {user.image ? <AvatarImage src={user.image} alt={user.name} /> : null}
              <AvatarFallback className={cn('text-xs font-semibold', avatarTone(user.id))}>
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className='min-w-0 space-y-0.5'>
              <div className='truncate font-medium text-[var(--qx-text)]'>
                {user.name || m['admin.table.no_name']()}
              </div>
              <div className='truncate text-xs text-[var(--qx-muted)]'>{user.email}</div>
              <div className='font-mono text-[10px] text-[var(--qx-muted)]'>{shortId}</div>
            </div>
          </div>
        )
      },
    },
    {
      accessorKey: 'role',
      header: ({ column }) => (
        <Button
          variant='ghost'
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          className='h-auto p-0 font-medium text-[var(--qx-muted)] hover:text-[var(--qx-text)]'
        >
          Role
          <ArrowUpDown className='ml-2 h-4 w-4' />
        </Button>
      ),
      cell: ({ row }) => {
        const info = roleBadge(row.getValue('role') as string)
        return (
          <span
            className={cn(
              'inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold',
              info.className
            )}
          >
            {info.label}
          </span>
        )
      },
    },
    {
      accessorKey: 'createdAt',
      header: ({ column }) => (
        <Button
          variant='ghost'
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          className='h-auto p-0 font-medium text-[var(--qx-muted)] hover:text-[var(--qx-text)]'
        >
          Registered / Last Active
          <ArrowUpDown className='ml-2 h-4 w-4' />
        </Button>
      ),
      cell: ({ row }) => {
        const created = new Date(row.getValue('createdAt') as string | Date)
        const updated = new Date(row.original.updatedAt)
        const minutesAgo = (Date.now() - updated.getTime()) / 60_000
        const activeNow = minutesAgo >= 0 && minutesAgo < 30
        return (
          <div className='space-y-1 text-sm'>
            <div>{format(created, 'MMM d, yyyy')}</div>
            <div className='flex items-center gap-1.5 text-xs text-[var(--qx-muted)]'>
              {activeNow ? (
                <>
                  <span className='qx-live-dot' />
                  <span className='text-[var(--qx-success)]'>Active Now</span>
                </>
              ) : (
                <>
                  <Clock3 className='h-3 w-3' />
                  {formatDistanceToNow(updated, { addSuffix: true })}
                </>
              )}
            </div>
          </div>
        )
      },
    },
    {
      accessorKey: 'emailVerified',
      header: 'Email Status',
      cell: ({ row }) => {
        const verified = row.getValue('emailVerified') as boolean
        return verified ? (
          <span className='inline-flex items-center gap-1 text-xs font-medium text-[var(--qx-success)]'>
            <CheckCircle2 className='h-3.5 w-3.5' />
            Verified
          </span>
        ) : (
          <span className='inline-flex items-center gap-1 text-xs font-medium text-[var(--qx-warning)]'>
            <Clock3 className='h-3.5 w-3.5' />
            Pending
          </span>
        )
      },
    },
    {
      accessorKey: 'banned',
      header: 'Status',
      cell: ({ row }) => {
        const user = row.original
        if (user.banned) {
          return (
            <div className='space-y-1'>
              <span className='inline-flex rounded-md bg-[rgba(239,68,68,0.15)] px-2 py-0.5 text-[11px] font-semibold text-[var(--qx-danger)]'>
                Restricted
              </span>
              {user.banReason ? (
                <div className='max-w-[160px] truncate text-[10px] text-[var(--qx-muted)]'>
                  {user.banReason}
                </div>
              ) : null}
            </div>
          )
        }
        return (
          <span className='inline-flex rounded-md bg-[rgba(34,197,94,0.15)] px-2 py-0.5 text-[11px] font-semibold text-[var(--qx-success)]'>
            Active
          </span>
        )
      },
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => {
        const user = row.original
        return (
          <div className='flex items-center gap-1'>
            <UserActions user={user} onSuccess={refetch} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant='ghost' className='h-8 w-8 p-0 text-[var(--qx-muted)]'>
                  <span className='sr-only'>{m['admin.status.open_menu']()}</span>
                  <MoreHorizontal className='h-4 w-4' />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align='end'
                className='border-[var(--qx-border)] bg-[var(--qx-surface)]'
              >
                <DropdownMenuLabel className='flex items-center gap-1.5'>
                  <Shield className='h-3.5 w-3.5 text-[var(--qx-primary)]' />
                  {m['admin.status.user_actions']()}
                </DropdownMenuLabel>
                <DropdownMenuItem onClick={() => navigator.clipboard.writeText(user.id)}>
                  {m['admin.actions.copy_user_id']()}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigator.clipboard.writeText(user.email)}>
                  {m['admin.actions.copy_email']()}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className='text-muted-foreground'>
                  {m['admin.actions.view_details']()}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )
      },
    },
  ]
}

export const columns = createColumns(() => {})
