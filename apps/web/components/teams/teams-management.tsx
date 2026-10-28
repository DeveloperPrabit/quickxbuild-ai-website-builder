/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * teams-management.tsx — Team Management (Obsidian Kinetic)
 */

'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'
import {
  Download,
  Mail,
  RefreshCcwIcon,
  Search,
  Users,
} from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import * as m from '@/paraglide/messages'
import { useTRPC } from '@/trpc/client'
import { useMembershipStatus } from '@/hooks/use-membership-status'
import { authClient } from '@quickxbuild/auth/auth-client'
import { BrandMark } from '@/components/common/logo/BrandMark'
import { formatPlanDisplayName } from '@/components/marketing/price/utils/plan-display'
import { cn } from '@quickxbuild/ui/lib/utils'
import { InviteForm } from './team-components/invite-form'
import { MemberTable } from './team-components/member-table'
import { InvitationTable } from './team-components/invitation-table'
import { LoadingCard } from './team-components/loading-card'
import type { handleInviteMemberParams, Invitation, Member } from './team-components/types'
import '../dashboard/dashboard-kinetic.css'

type RosterTab = 'members' | 'invitations'

function planBadgeLabel(planName?: string): string {
  const n = (planName || 'free').toLowerCase()
  if (n.includes('max') || n.includes('advanced')) return 'MAX TIER'
  if (n.includes('business')) return 'BUSINESS TIER'
  if (n.includes('pro') || n.includes('basic')) return 'PRO TIER'
  return 'FREE TIER'
}

export function TeamsManagement() {
  const [members, setMembers] = useState<Member[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [organizationId, setOrganizationId] = useState<string | undefined>(undefined)
  const [tab, setTab] = useState<RosterTab>('members')
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [page, setPage] = useState(0)
  const pageSize = 8

  const initialized = useRef(false)
  const trpc = useTRPC()
  const { data: session } = authClient.useSession()
  const currentUserId = session?.user?.id
  const { canInviteMembers, handleUpgrade, isLoading: membershipLoading, membershipStatus } =
    useMembershipStatus()
  const assertCanInvite = useMutation(trpc.workspaceBilling.assertCanInvite.mutationOptions())

  // @ts-ignore
  const { data: activeOrganization } = authClient.useActiveOrganization()

  const fetchOrganizationData = async (orgId: string) => {
    try {
      setIsLoading(true)
      setOrganizationId(orgId)

      const invitationsResponse = await authClient.organization.listInvitations({
        query: { organizationId: orgId },
      })

      if (invitationsResponse && 'data' in invitationsResponse) {
        setInvitations(invitationsResponse.data || [])
      }

      if (activeOrganization?.members) {
        setMembers(activeOrganization.members as unknown as Member[])
      }
    } catch (error) {
      console.error('Failed to fetch team data:', error)
      toast.error(m['dashboard.teams.errors.fetchFailed']())
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (initialized.current && members.length > 0) return
    if (!activeOrganization?.id) return
    initialized.current = true
    fetchOrganizationData(activeOrganization.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrganization, members.length])

  const refreshData = async () => {
    if (!activeOrganization?.id) return
    toast.info(m['dashboard.teams.refreshing'](), { id: 'refresh-data' })
    await fetchOrganizationData(activeOrganization.id)
    toast.success(m['dashboard.teams.refreshSuccess'](), { id: 'refresh-data' })
  }

  const handleInviteMember = async (params: handleInviteMemberParams) => {
    if (!organizationId) {
      toast.error(m['dashboard.teams.errors.noOrganization']())
      return
    }
    if (!canInviteMembers) {
      toast.error(
        'Team workspaces are restricted to the Business Plan. Please upgrade to unlock collaboration features.'
      )
      handleUpgrade()
      return
    }

    try {
      setIsLoading(true)
      await assertCanInvite.mutateAsync()
      await authClient.organization.inviteMember({
        email: params.email,
        role: params.role as 'admin' | 'member' | 'owner',
        organizationId,
      })
      toast.success(m['dashboard.teams.inviteForm.invitationSent']({ email: params.email }))
      setInvitations((prev) => [
        ...prev,
        {
          id: `temp-${Date.now()}`,
          email: params.email,
          role: params.role,
          status: 'pending',
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          organizationId,
          inviterId: currentUserId || '',
          teamId: undefined,
        },
      ])
      setTab('invitations')
    } catch (error) {
      const message =
        error instanceof Error ? error.message : m['dashboard.teams.inviteForm.sendFailed']()
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  }

  const handleCancelInvitation = async (invitationId: string, email: string) => {
    try {
      setIsLoading(true)
      await authClient.organization.cancelInvitation({ invitationId })
      toast.success(m['dashboard.teams.invitationTable.actions.canceled']({ email }))
      setInvitations((current) =>
        current.map((inv) => (inv.id === invitationId ? { ...inv, status: 'canceled' } : inv))
      )
    } catch {
      toast.error(m['dashboard.teams.invitationTable.actions.cancelFailed']())
    } finally {
      setIsLoading(false)
    }
  }

  const handleRemoveMember = async (
    memberId: string,
    orgId: string,
    name = '',
    email = ''
  ) => {
    try {
      setIsLoading(true)
      await authClient.organization.removeMember({
        memberIdOrEmail: memberId,
        organizationId: orgId,
      })
      toast.success(m['dashboard.teams.memberTable.actions.removed']({ name: name || email || '' }))
      setMembers((prev) => prev.filter((member) => member.id !== memberId))
    } catch {
      toast.error(m['dashboard.teams.memberTable.actions.removeFailed']())
    } finally {
      setIsLoading(false)
    }
  }

  const handleUpdateMemberRole = async (memberId: string, role: string) => {
    try {
      setIsLoading(true)
      await authClient.organization.updateMemberRole({
        memberId,
        role: role as 'admin' | 'member' | 'owner',
      })
      toast.success(m['dashboard.teams.memberTable.actions.roleUpdated']())
      setMembers((current) =>
        current.map((member) => (member.id === memberId ? { ...member, role } : member))
      )
    } catch {
      toast.error(m['dashboard.teams.memberTable.actions.roleUpdateFailed']())
    } finally {
      setIsLoading(false)
    }
  }

  const pendingInvites = invitations.filter((inv) => {
    const expired = new Date(inv.expiresAt) < new Date()
    return inv.status === 'pending' && !expired
  })

  const roleCounts = useMemo(() => {
    const owners = members.filter((mbr) => mbr.role === 'owner').length
    const admins = members.filter((mbr) => mbr.role === 'admin').length
    const rest = members.length - owners - admins
    return { owners, admins, rest }
  }, [members])

  const filteredMembers = useMemo(() => {
    const q = query.trim().toLowerCase()
    return members.filter((member) => {
      if (roleFilter !== 'all' && member.role !== roleFilter) return false
      if (!q) return true
      const hay = `${member.user?.name || ''} ${member.user?.email || ''} ${member.role}`.toLowerCase()
      return hay.includes(q)
    })
  }, [members, query, roleFilter])

  const filteredInvites = useMemo(() => {
    const q = query.trim().toLowerCase()
    return invitations.filter((inv) => {
      if (roleFilter !== 'all' && inv.role !== roleFilter) return false
      if (!q) return true
      return `${inv.email} ${inv.role} ${inv.status}`.toLowerCase().includes(q)
    })
  }, [invitations, query, roleFilter])

  const roster = tab === 'members' ? filteredMembers : filteredInvites
  const pageCount = Math.max(1, Math.ceil(roster.length / pageSize))
  const pagedMembers = filteredMembers.slice(page * pageSize, page * pageSize + pageSize)
  const pagedInvites = filteredInvites.slice(page * pageSize, page * pageSize + pageSize)

  useEffect(() => {
    setPage(0)
  }, [tab, query, roleFilter])

  const seatsLimit = membershipStatus?.usage.seatsLimit || Math.max(members.length, 1)
  const seatsUsed = members.length
  const seatsPct = Math.min(100, Math.round((seatsUsed / seatsLimit) * 100))
  const vacant = Math.max(0, seatsLimit - seatsUsed)
  const planName = formatPlanDisplayName(membershipStatus?.plan || 'FREE')
  const periodEnd = membershipStatus?.periodEnd ? new Date(membershipStatus.periodEnd) : null
  const lastInvite = [...invitations].sort(
    (a, b) => new Date(b.expiresAt).getTime() - new Date(a.expiresAt).getTime()
  )[0]

  const exportCsv = () => {
    const rows =
      tab === 'members'
        ? [
            ['Name', 'Email', 'Role', 'Joined'].join(','),
            ...filteredMembers.map((member) =>
              [
                `"${member.user?.name || ''}"`,
                member.user?.email || '',
                member.role,
                member.createdAt,
              ].join(',')
            ),
          ]
        : [
            ['Email', 'Role', 'Status', 'Expires'].join(','),
            ...filteredInvites.map((inv) =>
              [inv.email, inv.role, inv.status, inv.expiresAt].join(',')
            ),
          ]
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = tab === 'members' ? 'team-members.csv' : 'team-invitations.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!activeOrganization) {
    return <LoadingCard />
  }

  return (
    <div className='dashboard-kinetic px-3 sm:px-4 lg:px-6'>
      <div className='mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between'>
        <div>
          <p className='mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--qx-muted)]'>
            Workspace Hierarchy · v4.8 Security Matrix
          </p>
          <h1 className='text-[28px] font-semibold tracking-tight sm:text-[32px]'>
            Team Management
          </h1>
          <p className='mt-1 max-w-xl text-sm text-[var(--qx-muted)]'>
            Manage team members, organization seats, granular project permissions, and automated
            invite dispatches.
          </p>
        </div>
        <div className='flex flex-wrap gap-2'>
          <button
            type='button'
            onClick={refreshData}
            disabled={isLoading}
            className='qx-btn-ghost inline-flex items-center gap-2 px-3 py-2 text-xs'
          >
            <RefreshCcwIcon className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
            Refresh Data
          </button>
          <Link
            href='/dashboard/billing'
            className='qx-btn-ghost inline-flex items-center gap-2 px-3 py-2 text-xs'
          >
            <Users className='h-3.5 w-3.5' />
            Manage Plan Seats
          </Link>
        </div>
      </div>

      <section className='qx-card mb-5 p-5'>
        <div className='flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between'>
          <div className='flex min-w-0 items-start gap-4'>
            <BrandMark className='h-12 w-12' />
            <div className='min-w-0'>
              <h2 className='truncate text-lg font-semibold'>
                {activeOrganization.name || m['dashboard.teams.unnamedOrganization']()}
              </h2>
              <div className='mt-1.5 flex flex-wrap items-center gap-2'>
                <span className='qx-pill qx-pill-coral'>{planBadgeLabel(membershipStatus?.plan)}</span>
                <span className='qx-pill qx-pill-live'>
                  <span className='qx-live-dot' />
                  Live Sync
                </span>
              </div>
              <p className='mt-2 text-xs text-[var(--qx-muted)]'>
                {planName}
                {periodEnd
                  ? ` · Auto-renewal ${formatDistanceToNow(periodEnd, { addSuffix: true })}`
                  : ' · Forever free workspace'}
              </p>
            </div>
          </div>

          <div className='grid min-w-0 flex-1 grid-cols-2 gap-4 sm:grid-cols-3 lg:max-w-xl'>
            <div className='col-span-2 sm:col-span-1'>
              <p className='text-[10px] font-semibold uppercase tracking-wider text-[var(--qx-muted)]'>
                Seat Allocation
              </p>
              <p className='mt-1 text-sm font-semibold tabular-nums'>
                {seatsUsed}/{seatsLimit} Seats Used ({seatsPct}%)
              </p>
              <div className='qx-progress mt-2'>
                <span style={{ width: `${seatsPct}%` }} />
              </div>
              <p className='mt-1 text-[11px] text-[var(--qx-muted)]'>
                {vacant} vacant slot{vacant === 1 ? '' : 's'} remaining
              </p>
            </div>
            <div>
              <p className='text-[10px] font-semibold uppercase tracking-wider text-[var(--qx-muted)]'>
                Invite Policy
              </p>
              <p className='mt-1 text-lg font-semibold'>
                {canInviteMembers ? 'Open' : 'Gated'}
              </p>
              <p className='text-[11px] text-[var(--qx-muted)]'>
                {canInviteMembers ? 'Business+ collaboration' : 'Upgrade to invite'}
              </p>
            </div>
            <div>
              <p className='text-[10px] font-semibold uppercase tracking-wider text-[var(--qx-muted)]'>
                Active Ops
              </p>
              <p className='mt-1 text-lg font-semibold tabular-nums'>
                {members.length}/{seatsLimit}
              </p>
              <p className='text-[11px] text-[var(--qx-muted)]'>Teams seated</p>
            </div>
          </div>
        </div>
      </section>

      <div className='mb-5 grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(260px,0.8fr)]'>
        <InviteForm
          onInvite={handleInviteMember}
          isLoading={isLoading || membershipLoading}
          disabled={!canInviteMembers}
          disabledReason={
            !canInviteMembers
              ? 'Team workspaces are restricted to the Business Plan. Upgrade to unlock collaboration features.'
              : undefined
          }
          onUpgrade={handleUpgrade}
        />

        <aside className='qx-card p-5'>
          <div className='mb-4 flex items-center justify-between'>
            <h3 className='text-sm font-semibold'>Role Matrix</h3>
            <span className='text-[10px] font-semibold uppercase tracking-wider text-[var(--qx-muted)]'>
              RBAC
            </span>
          </div>
          <ul className='space-y-3 text-sm'>
            <li className='flex items-center justify-between'>
              <span className='inline-flex items-center gap-2'>
                <span className='size-2 rounded-full bg-[var(--qx-primary)]' />
                Organization Owner
              </span>
              <span className='tabular-nums text-[var(--qx-muted)]'>{roleCounts.owners} user</span>
            </li>
            <li className='flex items-center justify-between'>
              <span className='inline-flex items-center gap-2'>
                <span className='size-2 rounded-full bg-[var(--qx-cyan)]' />
                Admin Privileges
              </span>
              <span className='tabular-nums text-[var(--qx-muted)]'>{roleCounts.admins} users</span>
            </li>
            <li className='flex items-center justify-between'>
              <span className='inline-flex items-center gap-2'>
                <span className='size-2 rounded-full bg-[#a1a1aa]' />
                Developers &amp; Members
              </span>
              <span className='tabular-nums text-[var(--qx-muted)]'>{roleCounts.rest} users</span>
            </li>
          </ul>
          <div className='mt-4 flex items-center justify-between border-t border-[var(--qx-border)] pt-3 text-xs'>
            <span className='text-[var(--qx-muted)]'>SSO &amp; SAML Enforcement</span>
            <Link href='/dashboard/session' className='font-medium text-[var(--qx-primary)]'>
              Configure SSO
            </Link>
          </div>
        </aside>
      </div>

      <section className='qx-card overflow-hidden'>
        <div className='flex flex-col gap-3 border-b border-[var(--qx-border)] px-4 py-3 lg:flex-row lg:items-center lg:justify-between'>
          <div className='flex flex-wrap gap-1 rounded-lg border border-[var(--qx-border)] bg-[var(--qx-bg)] p-1'>
            <button
              type='button'
              onClick={() => setTab('members')}
              className={cn(
                'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium',
                tab === 'members'
                  ? 'bg-[rgba(255,115,71,0.15)] text-[var(--qx-primary)]'
                  : 'text-[var(--qx-muted)] hover:text-[var(--qx-text)]'
              )}
            >
              <Users className='h-3.5 w-3.5' />
              Team Members
              <span className='rounded bg-[rgba(255,255,255,0.08)] px-1.5'>{members.length}</span>
            </button>
            <button
              type='button'
              onClick={() => setTab('invitations')}
              className={cn(
                'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium',
                tab === 'invitations'
                  ? 'bg-[rgba(255,115,71,0.15)] text-[var(--qx-primary)]'
                  : 'text-[var(--qx-muted)] hover:text-[var(--qx-text)]'
              )}
            >
              <Mail className='h-3.5 w-3.5' />
              Pending Invitations
              <span className='rounded bg-[rgba(255,255,255,0.08)] px-1.5'>
                {pendingInvites.length}
              </span>
            </button>
          </div>

          <div className='flex flex-wrap items-center gap-2'>
            <label className='relative min-w-[200px] flex-1'>
              <Search className='pointer-events-none absolute top-2.5 left-2.5 h-3.5 w-3.5 text-[var(--qx-muted)]' />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder='Filter by name, email, role…'
                className='h-9 w-full rounded-lg border border-[var(--qx-border)] bg-[var(--qx-bg)] pr-3 pl-8 text-xs outline-none placeholder:text-[var(--qx-muted)] focus:border-[rgba(255,115,71,0.45)]'
              />
            </label>
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className='h-9 rounded-lg border border-[var(--qx-border)] bg-[var(--qx-bg)] px-2 text-xs outline-none'
            >
              <option value='all'>All Roles</option>
              <option value='owner'>Owner</option>
              <option value='admin'>Admin</option>
              <option value='member'>Member</option>
            </select>
            <button
              type='button'
              onClick={exportCsv}
              className='qx-btn-ghost inline-flex h-9 w-9 items-center justify-center'
              aria-label='Export CSV'
            >
              <Download className='h-3.5 w-3.5' />
            </button>
          </div>
        </div>

        {tab === 'members' ? (
          <MemberTable
            members={pagedMembers}
            isLoading={isLoading}
            organizationId={organizationId || ''}
            onUpdateRole={handleUpdateMemberRole}
            onRemoveMember={handleRemoveMember}
            currentUserId={currentUserId}
            totalCount={filteredMembers.length}
          />
        ) : (
          <InvitationTable
            invitations={pagedInvites}
            isLoading={isLoading}
            onCancelInvitation={handleCancelInvitation}
          />
        )}

        <div className='flex items-center justify-between border-t border-[var(--qx-border)] px-4 py-3 text-xs text-[var(--qx-muted)]'>
          <span>
            Showing {roster.length === 0 ? 0 : page * pageSize + 1}–
            {Math.min(roster.length, (page + 1) * pageSize)} of {roster.length}
          </span>
          <div className='flex gap-2'>
            <button
              type='button'
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className='qx-btn-ghost px-3 py-1.5 disabled:opacity-40'
            >
              Previous
            </button>
            <button
              type='button'
              disabled={page >= pageCount - 1}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              className='qx-btn-ghost px-3 py-1.5 disabled:opacity-40'
            >
              Next
            </button>
          </div>
        </div>
      </section>

      <div className='mt-4 flex flex-col gap-2 px-1 text-xs text-[var(--qx-muted)] sm:flex-row sm:items-center sm:justify-between'>
        <p className='inline-flex items-center gap-2'>
          <span className='size-1.5 rounded-full bg-[var(--qx-primary)]' />
          Audit Stream:{' '}
          {lastInvite
            ? `Invitation for ${lastInvite.email} · ${lastInvite.status}`
            : members[0]?.user?.email
              ? `Workspace roster synced for ${members[0].user.email}`
              : 'No recent team events'}
        </p>
        <div className='flex gap-3'>
          <Link href='/dashboard/session' className='text-[var(--qx-primary)] hover:underline'>
            View Complete Audit Log
          </Link>
          <a href='https://docs.quickxbuild.dev' className='hover:underline' target='_blank' rel='noreferrer'>
            API Docs
          </a>
        </div>
      </div>
    </div>
  )
}
