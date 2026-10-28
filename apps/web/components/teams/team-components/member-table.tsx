/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * member-table.tsx — Kinetic members table
 */

'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@quickxbuild/ui/components/dialog'
import { Avatar, AvatarFallback, AvatarImage } from '@quickxbuild/ui/components/avatar'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@quickxbuild/ui/components/select'
import { AlertCircleIcon, TrashIcon, UserIcon } from 'lucide-react'
import * as m from '@/paraglide/messages'
import { RoleBadge, MemberStatusBadge, getMemberStatus } from './status-badges'
import type { MemberTableProps, Member } from './types'

export function MemberTable({
  members,
  isLoading,
  organizationId,
  onUpdateRole,
  onRemoveMember,
  currentUserId,
  totalCount,
}: MemberTableProps) {
  const [memberToRemove, setMemberToRemove] = useState<Member | null>(null)

  const handleRemoveMember = async () => {
    if (!memberToRemove) return
    await onRemoveMember(
      memberToRemove.id,
      organizationId,
      memberToRemove.user?.name,
      memberToRemove.user?.email
    )
    setMemberToRemove(null)
  }

  const shown = totalCount ?? members.length

  return (
    <div>
      <div className='overflow-x-auto'>
        <table className='w-full min-w-[720px] text-left text-sm'>
          <thead>
            <tr className='border-b border-[var(--qx-border)] text-[11px] uppercase tracking-wide text-[var(--qx-muted)]'>
              <th className='px-4 py-3 font-medium'>Name &amp; Avatar</th>
              <th className='hidden px-4 py-3 font-medium md:table-cell'>Email</th>
              <th className='px-4 py-3 font-medium'>Role</th>
              <th className='hidden px-4 py-3 font-medium lg:table-cell'>Access Scope</th>
              <th className='hidden px-4 py-3 font-medium md:table-cell'>Joined</th>
              <th className='hidden px-4 py-3 font-medium sm:table-cell'>Status</th>
              <th className='px-4 py-3 text-right font-medium'>Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, index) => (
                <tr key={`skeleton-${index}`} className='border-b border-[var(--qx-border)]'>
                  <td className='px-4 py-3' colSpan={7}>
                    <div className='h-10 animate-pulse rounded-md bg-[var(--qx-surface-2)]' />
                  </td>
                </tr>
              ))
            ) : members.length === 0 ? (
              <tr>
                <td colSpan={7} className='px-4 py-12 text-center'>
                  <div className='flex flex-col items-center gap-2 text-[var(--qx-muted)]'>
                    <UserIcon className='h-8 w-8 opacity-40' />
                    <p>{m['dashboard.teams.memberTable.noMembers']()}</p>
                    <p className='text-sm'>{m['dashboard.teams.memberTable.inviteFirst']()}</p>
                  </div>
                </td>
              </tr>
            ) : (
              members.map((member) => {
                const isYou = Boolean(currentUserId && member.userId === currentUserId)
                const displayName =
                  member.user?.name ||
                  (member.user?.email
                    ? member.user.email.split('@')[0]
                    : m['dashboard.teams.memberTable.unnamedUser']())
                const initials = (
                  member.user?.name?.charAt(0) ||
                  member.user?.email?.charAt(0) ||
                  'U'
                ).toUpperCase()

                return (
                  <tr
                    key={member.id}
                    className='border-b border-[var(--qx-border)] transition-colors hover:bg-[rgba(255,255,255,0.02)]'
                  >
                    <td className='px-4 py-3'>
                      <div className='flex items-center gap-3'>
                        <Avatar className='h-9 w-9 border border-[var(--qx-border)]'>
                          {member.user?.image ? (
                            <AvatarImage
                              src={member.user.image}
                              alt={member.user.name || m['avatar.userAlt']()}
                            />
                          ) : null}
                          <AvatarFallback className='bg-[var(--qx-surface-2)] text-xs'>
                            {initials}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <div className='flex flex-wrap items-center gap-2 font-medium'>
                            {displayName}
                            {isYou ? (
                              <span className='rounded bg-[rgba(255,115,71,0.15)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--qx-primary)]'>
                                You
                              </span>
                            ) : null}
                          </div>
                          <div className='text-xs text-[var(--qx-muted)] md:hidden'>
                            {member.user?.email || ''}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className='hidden px-4 py-3 text-[var(--qx-muted)] md:table-cell'>
                      {member.user?.email || '—'}
                    </td>
                    <td className='px-4 py-3'>
                      <RoleBadge role={member.role} />
                    </td>
                    <td className='hidden px-4 py-3 text-[var(--qx-muted)] lg:table-cell'>
                      {member.role === 'owner' ? 'Global Root' : 'All Projects'}
                    </td>
                    <td className='hidden px-4 py-3 text-[var(--qx-muted)] md:table-cell'>
                      {format(new Date(member.createdAt), 'MMM d, yyyy')}
                    </td>
                    <td className='hidden px-4 py-3 sm:table-cell'>
                      <MemberStatusBadge status={getMemberStatus(member.role)} />
                    </td>
                    <td className='px-4 py-3 text-right'>
                      {member.role !== 'owner' ? (
                        <div className='flex justify-end gap-2'>
                          <Select
                            value={member.role}
                            onValueChange={(value) => onUpdateRole(member.id, value)}
                            disabled={isLoading}
                          >
                            <SelectTrigger className='h-8 w-24 border-[var(--qx-border)] bg-[var(--qx-bg)] text-xs'>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value='admin'>
                                {m['dashboard.teams.inviteForm.roleAdmin']()}
                              </SelectItem>
                              <SelectItem value='member'>
                                {m['dashboard.teams.inviteForm.roleMember']()}
                              </SelectItem>
                            </SelectContent>
                          </Select>

                          <Dialog>
                            <DialogTrigger asChild>
                              <button
                                type='button'
                                disabled={isLoading}
                                onClick={() => setMemberToRemove(member)}
                                className='inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--qx-danger)] opacity-70 hover:bg-[rgba(239,68,68,0.12)] hover:opacity-100 disabled:opacity-40'
                              >
                                <TrashIcon className='h-4 w-4' />
                              </button>
                            </DialogTrigger>
                            <DialogContent className='border-[var(--qx-border)] bg-[var(--qx-surface)] sm:max-w-[425px]'>
                              <DialogHeader>
                                <DialogTitle className='flex items-center gap-2 text-[var(--qx-danger)]'>
                                  <AlertCircleIcon className='h-5 w-5' />
                                  {m['dashboard.teams.memberTable.actions.confirmRemove']()}
                                </DialogTitle>
                                <DialogDescription>
                                  {m['dashboard.teams.memberTable.actions.confirmRemoveDesc']({
                                    name:
                                      memberToRemove?.user?.name ||
                                      memberToRemove?.user?.email ||
                                      m['dashboard.teams.memberTable.unnamedUser'](),
                                  })}
                                </DialogDescription>
                              </DialogHeader>
                              <DialogFooter className='gap-2 sm:gap-0'>
                                <button
                                  type='button'
                                  onClick={() => setMemberToRemove(null)}
                                  className='qx-btn-ghost px-3 py-2 text-sm'
                                >
                                  {m['dashboard.teams.memberTable.actions.cancel']()}
                                </button>
                                <button
                                  type='button'
                                  onClick={handleRemoveMember}
                                  disabled={isLoading}
                                  className='rounded-lg bg-[var(--qx-danger)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50'
                                >
                                  {isLoading
                                    ? m['dashboard.teams.memberTable.actions.removing']()
                                    : m['dashboard.teams.memberTable.actions.confirm']()}
                                </button>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>
                        </div>
                      ) : (
                        <span className='pr-2 text-xs italic text-[var(--qx-muted)]'>
                          {m['dashboard.teams.inviteForm.roleOwner']()}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      {!isLoading && members.length > 0 ? (
        <div className='flex items-center justify-between border-t border-[var(--qx-border)] px-4 py-3 text-xs text-[var(--qx-muted)]'>
          <span>
            Showing {members.length} of {shown} total registered team members
          </span>
        </div>
      ) : null}
    </div>
  )
}
