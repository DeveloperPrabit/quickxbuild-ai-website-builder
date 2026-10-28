/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * admin-console.tsx — Mission Control admin shell (Obsidian Kinetic)
 */

'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import {
  AlertTriangle,
  Ban,
  KeyRound,
  Lock,
  Megaphone,
  Radio,
  Shield,
  ShieldAlert,
  UserCheck,
  Users,
} from 'lucide-react'
import { authClient } from '@quickxbuild/auth/auth-client'
import { cn } from '@quickxbuild/ui/lib/utils'
import { UserManagementTable } from '@/components/admin/user-management-table'
import type { AdminUser, AdminUserListResponse } from '@/lib/types/admin'
import '../dashboard/dashboard-kinetic.css'

async function listUsersQuery(query: Record<string, string | number>) {
  const response = await authClient.admin.listUsers({ query })
  return (response.data || response) as AdminUserListResponse
}

type AdminConsoleProps = {
  adminName: string
  adminEmail: string
  adminRole: string
}

export function AdminConsole({ adminName, adminEmail, adminRole }: AdminConsoleProps) {
  const totalsQuery = useQuery({
    queryKey: ['admin-metrics-total'],
    queryFn: () => listUsersQuery({ limit: 1, offset: 0 }),
    staleTime: 30_000,
  })

  const bannedQuery = useQuery({
    queryKey: ['admin-metrics-banned'],
    queryFn: () =>
      listUsersQuery({
        limit: 1,
        offset: 0,
        filterField: 'banned',
        filterOperator: 'eq',
        filterValue: 'true',
      }),
    staleTime: 30_000,
  })

  const pendingQuery = useQuery({
    queryKey: ['admin-metrics-pending'],
    queryFn: () =>
      listUsersQuery({
        limit: 1,
        offset: 0,
        filterField: 'emailVerified',
        filterOperator: 'eq',
        filterValue: 'false',
      }),
    staleTime: 30_000,
  })

  const recentQuery = useQuery({
    queryKey: ['admin-metrics-recent'],
    queryFn: () =>
      listUsersQuery({
        limit: 100,
        offset: 0,
        sortBy: 'updatedAt',
        sortDirection: 'desc',
      }),
    staleTime: 30_000,
    refetchInterval: 60_000,
  })

  const total = totalsQuery.data?.total ?? 0
  const banned = bannedQuery.data?.total ?? 0
  const pending = pendingQuery.data?.total ?? 0

  const recentUsers: AdminUser[] = recentQuery.data?.users ?? []
  const activeToday = useMemo(() => {
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000
    return recentUsers.filter((u) => {
      const t = new Date(u.updatedAt).getTime()
      return Number.isFinite(t) && t >= dayAgo
    }).length
  }, [recentUsers])

  const activeRate = total > 0 ? Math.round((activeToday / total) * 1000) / 10 : 0

  const roleLabel =
    adminRole === 'superadmin' ? 'Superadmin' : adminRole === 'admin' ? 'Admin' : adminRole

  const auditItems = useMemo(() => {
    return recentUsers.slice(0, 5).map((u) => {
      const when = formatDistanceToNow(new Date(u.updatedAt), { addSuffix: true })
      if (u.banned) {
        return {
          id: u.id,
          title: `Restriction enforced for ${u.name || u.email}`,
          meta: u.banReason || 'Policy',
          when,
          tone: 'danger' as const,
          icon: Ban,
        }
      }
      if (!u.emailVerified) {
        return {
          id: u.id,
          title: `Pending verification · ${u.email}`,
          meta: 'Email queue',
          when,
          tone: 'warn' as const,
          icon: UserCheck,
        }
      }
      if (u.role === 'admin' || u.role === 'superadmin') {
        return {
          id: u.id,
          title: `Privileged session · ${u.name || u.email}`,
          meta: u.role,
          when,
          tone: 'coral' as const,
          icon: Shield,
        }
      }
      return {
        id: u.id,
        title: `Account activity · ${u.name || u.email}`,
        meta: 'Member',
        when,
        tone: 'cyan' as const,
        icon: KeyRound,
      }
    })
  }, [recentUsers])

  const metrics = [
    {
      label: 'Total Users',
      value: total.toLocaleString(),
      hint: totalsQuery.isLoading ? 'Loading…' : 'Platform roster',
      tone: 'success' as const,
    },
    {
      label: 'Active Today',
      value: activeToday.toLocaleString(),
      hint: `${activeRate}% of roster (24h)`,
      tone: 'coral' as const,
    },
    {
      label: 'Restricted / Banned',
      value: banned.toLocaleString(),
      hint: 'Enforced',
      tone: 'danger' as const,
    },
    {
      label: 'Pending Verification',
      value: pending.toLocaleString(),
      hint: 'Queue',
      tone: 'warn' as const,
    },
  ]

  return (
    <div className='dashboard-kinetic px-3 sm:px-4 lg:px-6'>
      <section className='mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between'>
        <div>
          <div className='mb-2 flex flex-wrap items-center gap-2'>
            <Shield className='h-6 w-6 text-[var(--qx-primary)]' />
            <h1 className='text-[28px] font-semibold tracking-tight sm:text-[32px]'>Admin Console</h1>
            <span className='qx-pill qx-pill-coral'>MISSION CONTROL</span>
          </div>
          <p className='max-w-2xl text-sm text-[var(--qx-muted)]'>
            Govern users, enforce policy, and monitor security posture across QuickXBuild workspaces.
          </p>
        </div>

        <div className='qx-card flex min-w-[240px] items-center justify-between gap-3 p-4'>
          <div>
            <p className='text-[10px] font-semibold uppercase tracking-wider text-[var(--qx-muted)]'>
              Current Session Authority
            </p>
            <p className='mt-1 text-sm font-medium'>{adminEmail || adminName}</p>
          </div>
          <span className='qx-pill qx-pill-coral'>{roleLabel}</span>
        </div>
      </section>

      <div className='mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4'>
        {metrics.map((m) => (
          <div key={m.label} className='qx-card p-4'>
            <p className='text-xs font-medium uppercase tracking-wide text-[var(--qx-muted)]'>
              {m.label}
            </p>
            <p className='mt-2 font-semibold text-2xl tracking-tight tabular-nums'>{m.value}</p>
            <p
              className={cn(
                'mt-1 text-xs font-semibold',
                m.tone === 'success' && 'text-[var(--qx-success)]',
                m.tone === 'coral' && 'text-[var(--qx-primary)]',
                m.tone === 'danger' && 'text-[var(--qx-danger)]',
                m.tone === 'warn' && 'text-[var(--qx-warning)]'
              )}
            >
              {m.hint}
            </p>
          </div>
        ))}
      </div>

      <div className='grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]'>
        <div className='qx-card overflow-hidden p-4 sm:p-5'>
          <div className='mb-4 flex items-center gap-2'>
            <Users className='h-4 w-4 text-[var(--qx-primary)]' />
            <h2 className='text-lg font-semibold'>User Management</h2>
          </div>
          <UserManagementTable />
        </div>

        <aside className='flex flex-col gap-4'>
          <div className='qx-card p-4'>
            <div className='mb-3 flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                <Radio className='h-4 w-4 text-[var(--qx-cyan)]' />
                <h3 className='text-sm font-semibold'>Security Audit Stream</h3>
              </div>
              <span className='qx-pill qx-pill-live'>
                <span className='qx-live-dot' />
                Live
              </span>
            </div>
            <ul className='space-y-3'>
              {auditItems.length === 0 ? (
                <li className='text-xs text-[var(--qx-muted)]'>No recent account events yet.</li>
              ) : (
                auditItems.map((item) => {
                  const Icon = item.icon
                  return (
                    <li
                      key={item.id}
                      className='flex gap-2 border-b border-[var(--qx-border)] pb-3 last:border-0 last:pb-0'
                    >
                      <div
                        className={cn(
                          'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                          item.tone === 'danger' && 'bg-[rgba(239,68,68,0.15)] text-[var(--qx-danger)]',
                          item.tone === 'warn' && 'bg-[rgba(234,179,8,0.15)] text-[var(--qx-warning)]',
                          item.tone === 'coral' && 'bg-[rgba(255,115,71,0.15)] text-[var(--qx-primary)]',
                          item.tone === 'cyan' && 'bg-[rgba(56,189,248,0.15)] text-[var(--qx-cyan)]'
                        )}
                      >
                        <Icon className='h-3.5 w-3.5' />
                      </div>
                      <div className='min-w-0 flex-1'>
                        <p className='truncate text-xs font-medium'>{item.title}</p>
                        <p className='text-[11px] text-[var(--qx-muted)]'>
                          {item.meta} · {item.when}
                        </p>
                      </div>
                    </li>
                  )
                })
              )}
            </ul>
            <p className='mt-3 text-[11px] text-[var(--qx-muted)]'>
              Derived from live user roster · full vault in a later phase
            </p>
          </div>

          <div className='qx-card p-4'>
            <h3 className='mb-3 text-sm font-semibold'>Quick Enforcements</h3>
            <ul className='space-y-2'>
              <li>
                <button
                  type='button'
                  className='qx-btn-ghost flex w-full items-center gap-2 px-3 py-2 text-left text-xs'
                  disabled
                  title='Coming in Enterprise packaging phase'
                >
                  <Lock className='h-3.5 w-3.5 text-[var(--qx-cyan)]' />
                  Bulk 2FA Requirement
                </button>
              </li>
              <li>
                <button
                  type='button'
                  className='qx-btn-ghost flex w-full items-center gap-2 px-3 py-2 text-left text-xs'
                  disabled
                  title='Coming soon'
                >
                  <Megaphone className='h-3.5 w-3.5 text-[var(--qx-primary)]' />
                  Send Workspace Broadcast
                </button>
              </li>
              <li>
                <button
                  type='button'
                  className='qx-btn-ghost flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--qx-danger)]'
                  disabled
                  title='Requires session revoke API wiring'
                >
                  <ShieldAlert className='h-3.5 w-3.5' />
                  Flush All Active Sessions
                </button>
              </li>
            </ul>
            <p className='mt-3 flex items-start gap-1.5 text-[11px] text-[var(--qx-muted)]'>
              <AlertTriangle className='mt-0.5 h-3 w-3 shrink-0 text-[var(--qx-warning)]' />
              Destructive actions stay gated until audit vault ships.
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}
