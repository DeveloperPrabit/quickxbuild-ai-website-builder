/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * invitation-table.tsx — Kinetic invitations table
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
import { AlertCircleIcon, CheckCircleIcon, TrashIcon } from 'lucide-react'
import * as m from '@/paraglide/messages'
import { RoleBadge, InvitationStatusBadge, getInvitationStatus } from './status-badges'
import type { InvitationTableProps, Invitation } from './types'

export function InvitationTable({
  invitations,
  isLoading,
  onCancelInvitation,
}: InvitationTableProps) {
  const [invitationToCancel, setInvitationToCancel] = useState<Invitation | null>(null)

  const handleCancelInvitation = async () => {
    if (!invitationToCancel) return
    await onCancelInvitation(invitationToCancel.id, invitationToCancel.email)
    setInvitationToCancel(null)
  }

  return (
    <div className='overflow-x-auto'>
      <table className='w-full min-w-[640px] text-left text-sm'>
        <thead>
          <tr className='border-b border-[var(--qx-border)] text-[11px] uppercase tracking-wide text-[var(--qx-muted)]'>
            <th className='px-4 py-3 font-medium'>Email</th>
            <th className='px-4 py-3 font-medium'>Role</th>
            <th className='hidden px-4 py-3 font-medium md:table-cell'>Status</th>
            <th className='hidden px-4 py-3 font-medium md:table-cell'>Expires</th>
            <th className='px-4 py-3 text-right font-medium'>Actions</th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            Array.from({ length: 3 }).map((_, index) => (
              <tr key={`inv-skeleton-${index}`} className='border-b border-[var(--qx-border)]'>
                <td className='px-4 py-3' colSpan={5}>
                  <div className='h-10 animate-pulse rounded-md bg-[var(--qx-surface-2)]' />
                </td>
              </tr>
            ))
          ) : invitations.length === 0 ? (
            <tr>
              <td colSpan={5} className='px-4 py-12 text-center'>
                <div className='flex flex-col items-center gap-2 text-[var(--qx-muted)]'>
                  <CheckCircleIcon className='h-8 w-8 opacity-40' />
                  <p>{m['dashboard.teams.invitationTable.noInvitations']()}</p>
                  <p className='text-sm'>{m['dashboard.teams.invitationTable.noInvitationsDesc']()}</p>
                </div>
              </td>
            </tr>
          ) : (
            invitations.map((invitation) => {
              const invitationStatus = getInvitationStatus(invitation)
              const canCancel = invitationStatus === 'pending'

              return (
                <tr
                  key={invitation.id}
                  className={`border-b border-[var(--qx-border)] transition-colors hover:bg-[rgba(255,255,255,0.02)] ${
                    invitationStatus === 'canceled' || invitationStatus === 'expired'
                      ? 'opacity-60'
                      : ''
                  }`}
                >
                  <td className='px-4 py-3 font-medium'>{invitation.email}</td>
                  <td className='px-4 py-3'>
                    <RoleBadge role={invitation.role} />
                  </td>
                  <td className='hidden px-4 py-3 md:table-cell'>
                    <InvitationStatusBadge status={invitationStatus} />
                  </td>
                  <td className='hidden px-4 py-3 text-[var(--qx-muted)] md:table-cell'>
                    {format(new Date(invitation.expiresAt), 'MMM d, yyyy')}
                  </td>
                  <td className='px-4 py-3 text-right'>
                    <Dialog>
                      <DialogTrigger asChild>
                        <button
                          type='button'
                          disabled={isLoading || !canCancel}
                          onClick={() => setInvitationToCancel(invitation)}
                          className='inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--qx-danger)] opacity-70 hover:bg-[rgba(239,68,68,0.12)] hover:opacity-100 disabled:opacity-40'
                        >
                          <TrashIcon className='h-4 w-4' />
                        </button>
                      </DialogTrigger>
                      <DialogContent className='border-[var(--qx-border)] bg-[var(--qx-surface)] sm:max-w-[425px]'>
                        <DialogHeader>
                          <DialogTitle className='flex items-center gap-2 text-[var(--qx-danger)]'>
                            <AlertCircleIcon className='h-5 w-5' />
                            {m['dashboard.teams.invitationTable.actions.confirmCancel']()}
                          </DialogTitle>
                          <DialogDescription>
                            {m['dashboard.teams.invitationTable.actions.confirmCancelDesc']({
                              email: invitationToCancel?.email || '',
                            })}
                          </DialogDescription>
                        </DialogHeader>
                        <div className='rounded-lg border border-[var(--qx-border)] bg-[var(--qx-bg)] p-4 text-sm'>
                          <div className='font-medium'>{invitationToCancel?.email}</div>
                          <div className='mt-2 flex flex-wrap items-center gap-2'>
                            {invitationToCancel ? (
                              <RoleBadge role={invitationToCancel.role} />
                            ) : null}
                            {invitationToCancel ? (
                              <InvitationStatusBadge
                                status={getInvitationStatus(invitationToCancel)}
                              />
                            ) : null}
                          </div>
                        </div>
                        <DialogFooter className='gap-2 sm:gap-0'>
                          <button
                            type='button'
                            onClick={() => setInvitationToCancel(null)}
                            className='qx-btn-ghost px-3 py-2 text-sm'
                          >
                            {m['dashboard.teams.invitationTable.actions.cancel']()}
                          </button>
                          <button
                            type='button'
                            onClick={handleCancelInvitation}
                            disabled={isLoading}
                            className='rounded-lg bg-[var(--qx-danger)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50'
                          >
                            {isLoading
                              ? m['dashboard.teams.invitationTable.actions.canceling']()
                              : m['dashboard.teams.invitationTable.actions.cancelButton']()}
                          </button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </td>
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}
