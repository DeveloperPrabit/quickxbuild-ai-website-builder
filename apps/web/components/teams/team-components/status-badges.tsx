/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * status-badges.tsx — Kinetic role / status pills
 */

'use client'

import { cn } from '@quickxbuild/ui/lib/utils'
import * as m from '@/paraglide/messages'
import type { InvitationStatus, MemberStatus } from './types'

export function RoleBadge({ role }: { role: string }) {
  const r = role.toLowerCase()
  const label =
    r === 'owner'
      ? m['dashboard.teams.inviteForm.roleOwner']()
      : r === 'admin'
        ? m['dashboard.teams.inviteForm.roleAdmin']()
        : m['dashboard.teams.inviteForm.roleMember']()

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold',
        r === 'owner' && 'bg-[rgba(255,115,71,0.18)] text-[#FF7347]',
        r === 'admin' && 'bg-[rgba(56,189,248,0.18)] text-[#38bdf8]',
        r !== 'owner' && r !== 'admin' && 'bg-[rgba(161,161,170,0.15)] text-[#a1a1aa]'
      )}
    >
      {label}
    </span>
  )
}

/** Members with a seat are treated as active (no random demo status). */
export function getMemberStatus(_role: string): MemberStatus {
  return 'active'
}

export function MemberStatusBadge({ status }: { status: MemberStatus }) {
  if (status === 'active') {
    return (
      <span className='inline-flex items-center gap-1.5 text-xs font-medium text-[var(--qx-success,#22c55e)]'>
        <span className='size-1.5 rounded-full bg-[var(--qx-success,#22c55e)] shadow-[0_0_6px_rgba(34,197,94,0.7)]' />
        {m['dashboard.teams.memberTable.status.active']()}
      </span>
    )
  }
  return (
    <span className='text-xs text-[var(--qx-muted,#a1a1aa)]'>
      {m['dashboard.teams.memberTable.status.unknown']()}
    </span>
  )
}

export function getInvitationStatus(invitation: {
  status: string
  expiresAt: Date | string
}): InvitationStatus {
  const now = new Date()
  const expiresAt = new Date(invitation.expiresAt)
  if (now > expiresAt) return 'expired'
  if (invitation.status === 'accepted') return 'accepted'
  if (invitation.status === 'canceled') return 'canceled'
  if (invitation.status === 'rejected') return 'rejected'
  return 'pending'
}

export function InvitationStatusBadge({ status }: { status: InvitationStatus }) {
  const map: Record<InvitationStatus, string> = {
    pending: 'bg-[rgba(234,179,8,0.15)] text-[var(--qx-warning,#eab308)]',
    accepted: 'bg-[rgba(34,197,94,0.15)] text-[var(--qx-success,#22c55e)]',
    expired: 'bg-[rgba(161,161,170,0.15)] text-[var(--qx-muted,#a1a1aa)]',
    canceled: 'bg-[rgba(239,68,68,0.15)] text-[var(--qx-danger,#ef4444)]',
    rejected: 'bg-[rgba(239,68,68,0.15)] text-[var(--qx-danger,#ef4444)]',
  }
  const labels: Record<InvitationStatus, string> = {
    pending: m['dashboard.teams.invitationTable.status.pending'](),
    accepted: m['dashboard.teams.invitationTable.status.accepted'](),
    expired: m['dashboard.teams.invitationTable.status.expired'](),
    canceled: m['dashboard.teams.invitationTable.status.canceled'](),
    rejected: m['dashboard.teams.invitationTable.status.rejected'](),
  }
  return (
    <span className={cn('inline-flex rounded-md px-2 py-0.5 text-[11px] font-semibold', map[status])}>
      {labels[status]}
    </span>
  )
}
