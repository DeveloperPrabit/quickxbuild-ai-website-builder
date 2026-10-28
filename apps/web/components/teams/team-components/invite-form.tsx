/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * invite-form.tsx
 */

'use client'

import { useForm } from 'react-hook-form'
import { z } from 'zod/v4'
import { zodResolver } from '@hookform/resolvers/zod'
import { MailIcon, Send, UserPlusIcon } from 'lucide-react'
import * as m from '@/paraglide/messages'
import type { InviteFormProps, handleInviteMemberParams } from './types'

const getInviteMemberSchema = () =>
  z.object({
    email: z.email({ error: m['dashboard.teams.inviteForm.emailInvalid']() }),
    role: z.string({ error: m['dashboard.teams.inviteForm.roleRequired']() }),
  })

export function InviteForm({
  onInvite,
  isLoading,
  disabled = false,
  disabledReason,
  onUpgrade,
}: InviteFormProps) {
  const InviteMemberSchema = getInviteMemberSchema()
  const formDisabled = isLoading || disabled

  const form = useForm<z.infer<typeof InviteMemberSchema>>({
    resolver: zodResolver(InviteMemberSchema),
    defaultValues: { email: '', role: 'member' },
  })

  const handleSubmit = async (data: z.infer<typeof InviteMemberSchema>) => {
    if (disabled) {
      onUpgrade?.()
      return
    }
    await onInvite(data as handleInviteMemberParams)
    form.reset({ email: '', role: 'member' })
  }

  return (
    <form onSubmit={form.handleSubmit(handleSubmit)} className='qx-card p-5'>
      <div className='mb-4 flex items-start justify-between gap-3'>
        <div>
          <h3 className='flex items-center gap-2 text-base font-semibold'>
            <UserPlusIcon className='h-4 w-4 text-[var(--qx-primary)]' />
            Invite Team Member
          </h3>
          <p className='mt-1 text-sm text-[var(--qx-muted)]'>
            {disabled && disabledReason
              ? disabledReason
              : 'Grant immediate operational access to workspace tools, agents, and pipelines.'}
          </p>
        </div>
        <span className='qx-pill qx-pill-cyan shrink-0'>Instant Provisioning</span>
      </div>

      <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3'>
        <div className='sm:col-span-2 lg:col-span-1'>
          <label htmlFor='email' className='mb-1.5 block text-xs font-medium text-[var(--qx-muted)]'>
            Email Address *
          </label>
          <div className='relative'>
            <MailIcon className='pointer-events-none absolute top-2.5 left-2.5 h-3.5 w-3.5 text-[var(--qx-muted)]' />
            <input
              id='email'
              placeholder='alex@example.com'
              disabled={formDisabled}
              className='h-10 w-full rounded-lg border border-[var(--qx-border)] bg-[var(--qx-bg)] pr-3 pl-8 text-sm outline-none placeholder:text-[var(--qx-muted)] focus:border-[rgba(255,115,71,0.45)] disabled:opacity-50'
              {...form.register('email')}
            />
          </div>
          {form.formState.errors.email ? (
            <p className='mt-1 text-xs text-[var(--qx-danger)]'>
              {form.formState.errors.email.message}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor='role' className='mb-1.5 block text-xs font-medium text-[var(--qx-muted)]'>
            Assign Role
          </label>
          <select
            id='role'
            disabled={formDisabled}
            value={form.watch('role')}
            onChange={(e) => form.setValue('role', e.target.value)}
            className='h-10 w-full rounded-lg border border-[var(--qx-border)] bg-[var(--qx-bg)] px-3 text-sm outline-none disabled:opacity-50'
          >
            <option value='member'>{m['dashboard.teams.inviteForm.roleMember']()}</option>
            <option value='admin'>{m['dashboard.teams.inviteForm.roleAdmin']()}</option>
          </select>
        </div>

        <div>
          <p className='mb-1.5 text-xs font-medium text-[var(--qx-muted)]'>Access Scope</p>
          <div className='flex h-10 items-center rounded-lg border border-[var(--qx-border)] bg-[var(--qx-bg)] px-3 text-sm text-[var(--qx-muted)]'>
            All Projects
          </div>
        </div>
      </div>

      <div className='mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
        <p className='text-xs text-[var(--qx-muted)]'>
          Recipient receives an invitation valid for 7 calendar days.
        </p>
        {disabled ? (
          <button
            type='button'
            onClick={() => onUpgrade?.()}
            className='qx-btn-primary inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm'
          >
            Upgrade to Business
          </button>
        ) : (
          <button
            type='submit'
            disabled={isLoading}
            className='qx-btn-primary inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm disabled:opacity-50'
          >
            <Send className='h-3.5 w-3.5' />
            {isLoading
              ? m['dashboard.teams.inviteForm.sending']()
              : m['dashboard.teams.inviteForm.sendInvitation']()}
          </button>
        )}
      </div>
    </form>
  )
}
