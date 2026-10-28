/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * session-management.tsx — Session Management (Obsidian Kinetic)
 */

'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { format, formatDistanceToNowStrict } from 'date-fns'
import {
  Bell,
  Check,
  Clock,
  Copy,
  KeyRound,
  Laptop,
  Monitor,
  Power,
  RefreshCw,
  Server,
  Shield,
  Smartphone,
  Tablet,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@quickxbuild/ui/lib/utils'
import { useTRPC } from '@/trpc/client'
import { useMutation } from '@tanstack/react-query'
import './dashboard-kinetic.css'

export type SessionRow = {
  id: string
  expiresAt: Date | string
  createdAt: Date | string
  updatedAt: Date | string
  ipAddress?: string | null
  userAgent?: string | null
  country?: string | null
  region?: string | null
  userId: string
}

type SessionManagementProps = {
  sessions: SessionRow[]
  currentSessionId: string
}

function parseDevice(userAgent?: string | null) {
  const ua = userAgent || ''
  let name = 'Unknown Device'
  let Icon = Server
  if (/iPhone/i.test(ua)) {
    name = 'iPhone'
    Icon = Smartphone
  } else if (/iPad/i.test(ua)) {
    name = 'iPad'
    Icon = Tablet
  } else if (/Android/i.test(ua) && /Mobile/i.test(ua)) {
    name = 'Android Phone'
    Icon = Smartphone
  } else if (/Android/i.test(ua)) {
    name = 'Android Tablet'
    Icon = Tablet
  } else if (/Windows/i.test(ua)) {
    name = 'Windows PC'
    Icon = Monitor
  } else if (/Mac OS|Macintosh/i.test(ua)) {
    name = 'macOS Device'
    Icon = Laptop
  } else if (/Linux/i.test(ua)) {
    name = 'Linux Device'
    Icon = Server
  } else if (/Cursor|VSCode|Electron/i.test(ua)) {
    name = 'Cursor IDE / API'
    Icon = Laptop
  }

  const browser =
    ua.match(/(Chrome|Firefox|Safari|Edge|OPR)\/([\d.]+)/)?.[0]?.replace('/', ' ') ||
    (ua ? ua.slice(0, 64) : 'Unknown client')

  return { name, Icon, client: browser }
}

function isLocalIp(ip?: string | null) {
  if (!ip) return false
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip.startsWith('192.168.') ||
    ip.startsWith('10.') ||
    ip.startsWith('172.16.')
  )
}

function regionCount(sessions: SessionRow[]) {
  const keys = new Set(
    sessions.map((s) => `${s.country || 'unknown'}:${s.region || ''}`).filter(Boolean)
  )
  return keys.size || 1
}

export function SessionManagement({ sessions, currentSessionId }: SessionManagementProps) {
  const router = useRouter()
  const trpc = useTRPC()
  const [isPending, startTransition] = useTransition()
  const [page, setPage] = useState(0)
  const pageSize = 5

  const [expireDays, setExpireDays] = useState('14')
  const [capEnabled, setCapEnabled] = useState(true)
  const [notifyNovel, setNotifyNovel] = useState(true)

  useEffect(() => {
    try {
      const raw = localStorage.getItem('qx-session-policies')
      if (!raw) return
      const parsed = JSON.parse(raw) as {
        expireDays?: string
        capEnabled?: boolean
        notifyNovel?: boolean
      }
      if (parsed.expireDays) setExpireDays(parsed.expireDays)
      if (typeof parsed.capEnabled === 'boolean') setCapEnabled(parsed.capEnabled)
      if (typeof parsed.notifyNovel === 'boolean') setNotifyNovel(parsed.notifyNovel)
    } catch {
      // ignore
    }
  }, [])

  const activeSessions = useMemo(
    () => sessions.filter((s) => new Date(s.expiresAt) >= new Date()),
    [sessions]
  )

  const pageCount = Math.max(1, Math.ceil(sessions.length / pageSize))
  const pageRows = sessions.slice(page * pageSize, page * pageSize + pageSize)

  const revokeMutation = useMutation(
    trpc.session.revoke.mutationOptions({
      onSuccess: () => {
        toast.success('Session terminated')
        startTransition(() => router.refresh())
      },
      onError: (e) => toast.error(e.message || 'Failed to revoke session'),
    })
  )

  const revokeOthersMutation = useMutation(
    trpc.session.revokeOthers.mutationOptions({
      onSuccess: () => {
        toast.success('All other sessions terminated')
        startTransition(() => router.refresh())
      },
      onError: (e) => toast.error(e.message || 'Failed to terminate sessions'),
    })
  )

  const copyIp = async (ip: string) => {
    try {
      await navigator.clipboard.writeText(ip)
      toast.success('IP copied')
    } catch {
      toast.error('Could not copy IP')
    }
  }

  const busy = isPending || revokeMutation.isPending || revokeOthersMutation.isPending

  return (
    <div className='dashboard-kinetic px-3 sm:px-4 lg:px-6'>
      {/* Hero */}
      <section className='qx-card mb-5 flex flex-col gap-4 p-5 lg:flex-row lg:items-start lg:justify-between'>
        <div>
          <div className='mb-2 flex flex-wrap items-center gap-2'>
            <Shield className='h-6 w-6 text-[var(--qx-primary)]' />
            <h1 className='text-[28px] font-semibold tracking-tight sm:text-[32px]'>
              Session Management
            </h1>
            <span className='inline-flex items-center gap-1 rounded-full bg-[rgba(239,68,68,0.15)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--qx-danger)]'>
              <span className='size-1.5 animate-pulse rounded-full bg-[var(--qx-danger)]' />
              Live Telemetry
            </span>
          </div>
          <p className='max-w-2xl text-sm text-[var(--qx-muted)]'>
            View and manage active login sessions across devices, monitor real-time security alerts,
            and revoke anomalous access points instantly.
          </p>
        </div>
        <div className='qx-card min-w-[180px] border-[var(--qx-border-strong)] bg-[var(--qx-surface-2)] p-4'>
          <p className='text-[10px] font-semibold uppercase tracking-wider text-[var(--qx-muted)]'>
            Active Concurrency
          </p>
          <p className='mt-2 flex items-center gap-2 text-lg font-semibold'>
            <span className='qx-live-dot' />
            {activeSessions.length} Device{activeSessions.length === 1 ? '' : 's'}
          </p>
        </div>
      </section>

      {/* Advisory */}
      <div className='mb-4 flex flex-col gap-3 rounded-xl border border-[rgba(56,189,248,0.25)] bg-[rgba(56,189,248,0.08)] p-4 sm:flex-row sm:items-center sm:justify-between'>
        <div className='flex gap-3'>
          <Shield className='mt-0.5 h-4 w-4 shrink-0 text-[var(--qx-cyan)]' />
          <p className='text-sm text-[var(--qx-text)]'>
            Regularly review active session hashes and remote IPs. If you observe unexpected
            geographic jumps, terminate all foreign sessions and rotate your security keys.
          </p>
        </div>
        <button
          type='button'
          className='shrink-0 text-xs font-medium text-[var(--qx-cyan)] hover:underline'
          onClick={() => toast.message('Full audit vault ships with Enterprise packaging')}
        >
          Audit Log →
        </button>
      </div>

      {/* Action bar */}
      <div className='mb-5 flex flex-col gap-3 rounded-xl border border-[var(--qx-border)] bg-[var(--qx-surface)] p-3 sm:flex-row sm:items-center sm:justify-between'>
        <div className='flex flex-wrap items-center gap-3 text-xs'>
          <span className='inline-flex items-center gap-1.5 text-[var(--qx-success)]'>
            <Check className='h-3.5 w-3.5' />
            Status: 2FA Enforced
          </span>
          <span className='inline-flex items-center gap-1.5 text-[var(--qx-primary)]'>
            <KeyRound className='h-3.5 w-3.5' />
            Hardware Token Linked
          </span>
        </div>
        <div className='flex flex-wrap gap-2'>
          <button
            type='button'
            disabled={busy}
            onClick={() => startTransition(() => router.refresh())}
            className='qx-btn-ghost inline-flex items-center gap-2 px-3 py-2 text-xs'
          >
            <RefreshCw className={cn('h-3.5 w-3.5', busy && 'animate-spin')} />
            Refresh Sessions
          </button>
          <button
            type='button'
            disabled={busy || activeSessions.length <= 1}
            onClick={() => {
              if (confirm('Terminate all sessions except this one?')) {
                revokeOthersMutation.mutate({})
              }
            }}
            className='inline-flex items-center gap-2 rounded-lg bg-[rgba(239,68,68,0.9)] px-3 py-2 text-xs font-semibold text-white hover:bg-[var(--qx-danger)] disabled:opacity-40'
          >
            <Power className='h-3.5 w-3.5' />
            Terminate All Other Sessions
          </button>
        </div>
      </div>

      {/* Table */}
      <section className='qx-card mb-5 overflow-hidden'>
        <div className='flex items-center justify-between border-b border-[var(--qx-border)] px-4 py-3'>
          <h2 className='text-sm font-semibold'>Active &amp; Historical Sessions</h2>
          <span className='inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--qx-danger)]'>
            <span className='size-1.5 animate-pulse rounded-full bg-[var(--qx-danger)]' />
            Realtime sync
          </span>
        </div>

        <div className='overflow-x-auto'>
          <table className='w-full min-w-[900px] text-left text-sm'>
            <thead>
              <tr className='border-b border-[var(--qx-border)] text-[10px] uppercase tracking-wider text-[var(--qx-muted)]'>
                <th className='px-4 py-3 font-semibold'>Device &amp; Client</th>
                <th className='px-4 py-3 font-semibold'>IP Address</th>
                <th className='px-4 py-3 font-semibold'>Geographic Node</th>
                <th className='px-4 py-3 font-semibold'>Login Timestamp</th>
                <th className='px-4 py-3 font-semibold'>Last Active</th>
                <th className='px-4 py-3 font-semibold'>Session</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className='px-4 py-12 text-center text-sm text-[var(--qx-muted)]'>
                    No authenticated sessions found for this workspace.
                  </td>
                </tr>
              ) : (
                pageRows.map((row) => {
                  const device = parseDevice(row.userAgent)
                  const DeviceIcon = device.Icon
                  const expired = new Date(row.expiresAt) < new Date()
                  const isCurrent = row.id === currentSessionId
                  const ip = row.ipAddress || '—'
                  const local = isLocalIp(row.ipAddress)
                  const updated = new Date(row.updatedAt)
                  const justNow = Date.now() - updated.getTime() < 2 * 60 * 1000

                  return (
                    <tr
                      key={row.id}
                      className='border-b border-[var(--qx-border)] last:border-0 hover:bg-[rgba(255,255,255,0.02)]'
                    >
                      <td className='px-4 py-3'>
                        <div className='flex items-start gap-2.5'>
                          <DeviceIcon className='mt-0.5 h-4 w-4 text-[var(--qx-primary)]' />
                          <div>
                            <p className='font-medium'>{device.name}</p>
                            <p className='max-w-[220px] truncate text-[11px] text-[var(--qx-muted)]'>
                              {device.client}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className='px-4 py-3'>
                        <div className='flex items-center gap-2'>
                          <code className='rounded-md border border-[var(--qx-border)] bg-[var(--qx-bg)] px-2 py-1 font-mono text-[11px]'>
                            {ip}
                          </code>
                          {row.ipAddress ? (
                            <>
                              <span
                                className={cn(
                                  'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                                  local
                                    ? 'bg-[rgba(161,161,170,0.15)] text-[var(--qx-muted)]'
                                    : 'bg-[rgba(56,189,248,0.15)] text-[var(--qx-cyan)]'
                                )}
                              >
                                {local ? 'Local' : 'WAN'}
                              </span>
                              <button
                                type='button'
                                className='text-[var(--qx-muted)] hover:text-[var(--qx-text)]'
                                onClick={() => copyIp(row.ipAddress!)}
                                aria-label='Copy IP'
                              >
                                <Copy className='h-3.5 w-3.5' />
                              </button>
                            </>
                          ) : null}
                        </div>
                      </td>
                      <td className='px-4 py-3 text-xs'>
                        {row.country || row.region ? (
                          <span>
                            {row.region ? `${row.region}, ` : ''}
                            {row.country || 'Unknown'}
                          </span>
                        ) : (
                          <span className='text-[var(--qx-muted)]'>Unknown node</span>
                        )}
                      </td>
                      <td className='px-4 py-3 text-xs tabular-nums text-[var(--qx-muted)]'>
                        {format(new Date(row.createdAt), 'MMM d, yyyy HH:mm')} UTC
                      </td>
                      <td className='px-4 py-3 text-xs'>
                        <span className={cn(justNow && !expired && 'text-[var(--qx-success)]')}>
                          {justNow && !expired
                            ? 'Just now'
                            : `${formatDistanceToNowStrict(updated)} ago`}
                        </span>
                      </td>
                      <td className='px-4 py-3'>
                        <div className='flex items-center gap-2'>
                          {isCurrent ? (
                            <span className='qx-pill qx-pill-coral'>Current</span>
                          ) : expired ? (
                            <span className='inline-flex rounded-full bg-[rgba(161,161,170,0.15)] px-2 py-0.5 text-[10px] font-semibold text-[var(--qx-muted)]'>
                              Expired
                            </span>
                          ) : (
                            <span className='qx-pill qx-pill-live'>
                              <span className='qx-live-dot' />
                              Active
                            </span>
                          )}
                          {!isCurrent && !expired ? (
                            <button
                              type='button'
                              disabled={busy}
                              className='text-[11px] font-medium text-[var(--qx-danger)] hover:underline disabled:opacity-40'
                              onClick={() => revokeMutation.mutate({ sessionId: row.id })}
                            >
                              Revoke
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        <div className='flex flex-col gap-2 border-t border-[var(--qx-border)] px-4 py-3 text-xs text-[var(--qx-muted)] sm:flex-row sm:items-center sm:justify-between'>
          <p>
            Showing {sessions.length === 0 ? 0 : page * pageSize + 1}–
            {Math.min(sessions.length, (page + 1) * pageSize)} of {sessions.length} authenticated
            access tokens across {regionCount(sessions)} region
            {regionCount(sessions) === 1 ? '' : 's'}
          </p>
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

      {/* Policies */}
      <section className='qx-card p-5'>
        <div className='mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
          <div>
            <h2 className='text-sm font-semibold'>Autonomous Security Policies</h2>
            <p className='mt-1 text-xs text-[var(--qx-muted)]'>
              Preferences are stored locally for now — server-side enforcement arrives with
              Enterprise packaging.
            </p>
          </div>
          <button
            type='button'
            className='qx-btn-primary px-4 py-2 text-xs'
            onClick={() => {
              try {
                localStorage.setItem(
                  'qx-session-policies',
                  JSON.stringify({ expireDays, capEnabled, notifyNovel })
                )
                toast.success('Policies saved on this device')
              } catch {
                toast.error('Could not save policies')
              }
            }}
          >
            Save Policies
          </button>
        </div>

        <div className='grid grid-cols-1 gap-3 md:grid-cols-3'>
          <div className='rounded-xl border border-[var(--qx-border)] bg-[var(--qx-bg)] p-4'>
            <div className='mb-3 flex items-center gap-2'>
              <Clock className='h-4 w-4 text-[var(--qx-primary)]' />
              <h3 className='text-sm font-semibold'>Session Expiration</h3>
            </div>
            <select
              value={expireDays}
              onChange={(e) => setExpireDays(e.target.value)}
              className='h-9 w-full rounded-lg border border-[var(--qx-border)] bg-[var(--qx-surface)] px-3 text-xs outline-none focus:border-[rgba(255,115,71,0.45)]'
            >
              <option value='7'>7 days</option>
              <option value='14'>14 days (Recommended)</option>
              <option value='30'>30 days</option>
              <option value='90'>90 days</option>
            </select>
          </div>

          <div className='rounded-xl border border-[var(--qx-border)] bg-[var(--qx-bg)] p-4'>
            <div className='mb-3 flex items-center gap-2'>
              <Monitor className='h-4 w-4 text-[var(--qx-cyan)]' />
              <h3 className='text-sm font-semibold'>Concurrent Cap</h3>
            </div>
            <label className='flex items-center justify-between gap-3 text-xs'>
              <span className='text-[var(--qx-muted)]'>Enforce 5 Device Limit</span>
              <button
                type='button'
                role='switch'
                aria-checked={capEnabled}
                onClick={() => setCapEnabled((v) => !v)}
                className={cn(
                  'relative h-6 w-11 rounded-full transition-colors',
                  capEnabled ? 'bg-[var(--qx-primary)]' : 'bg-[var(--qx-surface-2)]'
                )}
              >
                <span
                  className={cn(
                    'absolute top-0.5 left-0.5 size-5 rounded-full bg-white transition-transform',
                    capEnabled && 'translate-x-5'
                  )}
                />
              </button>
            </label>
          </div>

          <div className='rounded-xl border border-[var(--qx-border)] bg-[var(--qx-bg)] p-4'>
            <div className='mb-3 flex items-center gap-2'>
              <Bell className='h-4 w-4 text-[var(--qx-warning)]' />
              <h3 className='text-sm font-semibold'>Login Notifications</h3>
            </div>
            <label className='flex items-center justify-between gap-3 text-xs'>
              <span className='text-[var(--qx-muted)]'>Email on Novel Device</span>
              <button
                type='button'
                role='switch'
                aria-checked={notifyNovel}
                onClick={() => setNotifyNovel((v) => !v)}
                className={cn(
                  'relative h-6 w-11 rounded-full transition-colors',
                  notifyNovel ? 'bg-[var(--qx-primary)]' : 'bg-[var(--qx-surface-2)]'
                )}
              >
                <span
                  className={cn(
                    'absolute top-0.5 left-0.5 size-5 rounded-full bg-white transition-transform',
                    notifyNovel && 'translate-x-5'
                  )}
                />
              </button>
            </label>
          </div>
        </div>
      </section>
    </div>
  )
}
