/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * subscription-management.tsx — Billing UI (Obsidian Kinetic / design mock)
 */

'use client'

import { useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { format, differenceInCalendarDays } from 'date-fns'
import {
  Check,
  CreditCard,
  Download,
  FileText,
  FolderOpen,
  Headphones,
  Mail,
  Plus,
  Radar,
  Rocket,
  Sparkles,
  X,
  Zap,
} from 'lucide-react'
import { authClient } from '@quickxbuild/auth/auth-client'
import { cn } from '@quickxbuild/ui/lib/utils'
import { useSubscription } from '@/components/marketing/price/hooks/use-subscription'
import { formatPlanDisplayName } from '@/components/marketing/price/utils/plan-display'
import '../dashboard/dashboard-kinetic.css'

export type BillingSubscription = {
  aiNums: number
  aiNumsLimit: number
  seats: number
  seatsLimit: number
  projectNums: number
  projectNumsLimit: number
  plan: string
  periodEnd?: string
  planDetails?: {
    paid?: {
      aiNums: number
      projectNums: number
      aiNumsLimit?: number
      projectNumsLimit?: number
    } | null
    free?: {
      aiNums: number
      projectNums: number
      aiNumsLimit?: number
      projectNumsLimit?: number
    } | null
  }
}

type ViewTab = 'usage' | 'ledger'

function isPaidPlan(planName: string): boolean {
  const n = planName.toLowerCase()
  return n !== 'free' && !n.includes('free')
}

function tierLabel(planName: string): string {
  const n = planName.toLowerCase()
  if (n.includes('max') || n.includes('advanced')) return 'TIER-3'
  if (n.includes('business')) return 'TIER-2'
  if (n.includes('pro') || n.includes('basic')) return 'TIER-1'
  return 'TIER-0'
}

function planBadge(planName: string): string {
  const n = planName.toLowerCase()
  if (n.includes('max') || n.includes('advanced')) return 'MAX PLAN'
  if (n.includes('business')) return 'BUSINESS PLAN'
  if (n.includes('pro') || n.includes('basic')) return 'PRO PLAN'
  return 'FREE PLAN'
}

function planDescription(planName: string): string {
  const n = planName.toLowerCase()
  if (n.includes('max') || n.includes('advanced')) {
    return 'Enterprise cluster allocation enabled. Full access to autonomous receptionist fleets, neural site synthesis, and unrestricted distributed scraping runners.'
  }
  if (n.includes('business')) {
    return 'Team workspaces, invites, and shared autonomous modules for growing orgs.'
  }
  if (n.includes('pro') || n.includes('basic')) {
    return 'Custom domains, premium AI credits, and production hosting for growing projects.'
  }
  return 'Core QuickXBuild workspace — generate apps, preview, and explore the autonomous suite.'
}

function usedFromRemaining(remaining: number, limit?: number) {
  if (!limit || limit <= 0) return 0
  return Math.max(0, limit - remaining)
}

function ProgressBar({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0
  return (
    <div className='qx-progress mt-3'>
      <span style={{ width: `${pct}%` }} />
    </div>
  )
}

function UsageMeterCard({
  icon: Icon,
  title,
  used,
  total,
  unit,
  badge,
  badgeTone = 'cyan',
  footer,
  action,
}: {
  icon: typeof Sparkles
  title: string
  used: number
  total: number
  unit: string
  badge: string
  badgeTone?: 'cyan' | 'coral' | 'live'
  footer?: ReactNode
  action?: ReactNode
}) {
  const avail = total > 0 ? Math.max(0, 100 - (used / total) * 100) : 100
  return (
    <div className='qx-card flex flex-col p-4'>
      <div className='mb-3 flex items-start justify-between gap-2'>
        <div className='flex items-center gap-2'>
          <div className='flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--qx-surface-2)] text-[var(--qx-primary)]'>
            <Icon className='h-4 w-4' />
          </div>
          <h3 className='text-sm font-semibold'>{title}</h3>
        </div>
        <span
          className={cn(
            'qx-pill',
            badgeTone === 'coral' && 'qx-pill-coral',
            badgeTone === 'cyan' && 'qx-pill-cyan',
            badgeTone === 'live' && 'qx-pill-live'
          )}
        >
          {badge}
        </span>
      </div>
      <p className='font-semibold text-xl tabular-nums tracking-tight'>
        {used.toLocaleString()}
        <span className='text-sm font-normal text-[var(--qx-muted)]'>
          {' '}
          / {total > 0 ? total.toLocaleString() : '—'} {unit}
        </span>
      </p>
      {total > 0 ? (
        <p className='mt-1 text-[11px] text-[var(--qx-muted)]'>{avail.toFixed(2)}% avail</p>
      ) : (
        <p className='mt-1 text-[11px] text-[var(--qx-muted)]'>Module unlocking with suite rollout</p>
      )}
      <ProgressBar used={used} total={total || 1} />
      <div className='mt-auto flex items-center justify-between gap-2 pt-3'>
        <div className='text-[11px] text-[var(--qx-muted)]'>{footer}</div>
        {action}
      </div>
    </div>
  )
}

export function SubscriptionManagement({ subscription }: { subscription: BillingSubscription }) {
  const [tab, setTab] = useState<ViewTab>('usage')
  const { handleManageSubscription, isCreatingPortalSession } = useSubscription()
  const { data: session } = authClient.useSession()
  const userEmail = session?.user?.email || ''
  const userName = session?.user?.name || userEmail.split('@')[0] || 'Owner'

  const paid = isPaidPlan(subscription.plan)
  const displayName = formatPlanDisplayName(subscription.plan)
  const periodEnd = subscription.periodEnd ? new Date(subscription.periodEnd) : undefined
  const daysLeft =
    periodEnd && Number.isFinite(periodEnd.getTime())
      ? Math.max(0, differenceInCalendarDays(periodEnd, new Date()))
      : null

  const freeDetails = subscription.planDetails?.free
  const paidDetails = subscription.planDetails?.paid

  const freeAiUsed = usedFromRemaining(freeDetails?.aiNums ?? 0, freeDetails?.aiNumsLimit)
  const paidAiUsed = usedFromRemaining(paidDetails?.aiNums ?? 0, paidDetails?.aiNumsLimit)
  const totalAiUsed =
    freeDetails || paidDetails
      ? freeAiUsed + paidAiUsed
      : usedFromRemaining(subscription.aiNums, subscription.aiNumsLimit)
  const totalAiLimit =
    freeDetails || paidDetails
      ? (freeDetails?.aiNumsLimit || 0) + (paidDetails?.aiNumsLimit || 0)
      : subscription.aiNumsLimit

  const freeProjectsUsed = usedFromRemaining(
    freeDetails?.projectNums ?? 0,
    freeDetails?.projectNumsLimit
  )
  const paidProjectsUsed = usedFromRemaining(
    paidDetails?.projectNums ?? 0,
    paidDetails?.projectNumsLimit
  )
  const totalProjectsUsed =
    freeDetails || paidDetails
      ? freeProjectsUsed + paidProjectsUsed
      : usedFromRemaining(subscription.projectNums, subscription.projectNumsLimit)
  const totalProjectsLimit =
    freeDetails || paidDetails
      ? (freeDetails?.projectNumsLimit || 0) + (paidDetails?.projectNumsLimit || 0)
      : subscription.projectNumsLimit

  const seatsUsed = subscription.seatsLimit - subscription.seats
  const seatsLimit = subscription.seatsLimit

  const hybridFooter = useMemo(() => {
    if (!freeDetails?.aiNumsLimit && !paidDetails?.aiNumsLimit) return null
    return (
      <span>
        Paid {paidDetails?.aiNumsLimit || 0} · Free {freeDetails?.aiNumsLimit || 0} pooled
      </span>
    )
  }, [freeDetails, paidDetails])

  return (
    <div className='dashboard-kinetic px-3 sm:px-4 lg:px-6'>
      {/* Header */}
      <div className='mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between'>
        <div>
          <div className='mb-2 flex flex-wrap items-center gap-2'>
            <CreditCard className='h-6 w-6 text-[var(--qx-primary)]' />
            <h1 className='text-[28px] font-semibold tracking-tight sm:text-[32px]'>
              Subscription Management
            </h1>
            <span className='qx-pill qx-pill-coral'>{tierLabel(subscription.plan)}</span>
          </div>
          <p className='text-sm text-[var(--qx-muted)]'>
            Monitor quotas, billing cadence, and autonomous allocation for this workspace.
          </p>
        </div>
        <div className='flex flex-wrap gap-1 rounded-lg border border-[var(--qx-border)] bg-[var(--qx-surface)] p-1'>
          {(
            [
              ['usage', 'Real-time Usage'],
              ['ledger', 'Billing Ledger'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type='button'
              onClick={() => setTab(id)}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                tab === id
                  ? 'bg-[rgba(255,115,71,0.15)] text-[var(--qx-primary)]'
                  : 'text-[var(--qx-muted)] hover:text-[var(--qx-text)]'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Plan hero */}
      <section className='qx-card relative mb-5 overflow-hidden p-5 lg:p-6'>
        <div
          className='pointer-events-none absolute inset-0 opacity-50'
          style={{
            background:
              'radial-gradient(700px 240px at 90% 0%, rgba(255,115,71,0.18), transparent 55%)',
          }}
        />
        <div className='relative flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between'>
          <div className='max-w-3xl'>
            <div className='mb-3 flex flex-wrap gap-2'>
              <span className='qx-pill qx-pill-coral'>{planBadge(subscription.plan)}</span>
              <span className='qx-pill qx-pill-live'>
                <span className='qx-live-dot' />
                Active
              </span>
              {paid ? <span className='qx-pill qx-pill-cyan'>Auto Renews</span> : null}
              {periodEnd ? (
                <span className='qx-pill qx-pill-cyan'>
                  Cycle ends {format(periodEnd, 'MMM d, yyyy')}
                </span>
              ) : (
                <span className='qx-pill qx-pill-cyan'>Forever free tier</span>
              )}
            </div>
            <h2 className='text-2xl font-semibold tracking-tight sm:text-[28px]'>
              {displayName} Plan
            </h2>
            <p className='mt-2 text-sm text-[var(--qx-muted)]'>{planDescription(subscription.plan)}</p>
            <div className='mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[var(--qx-muted)]'>
              {periodEnd ? (
                <span>Renews: {format(periodEnd, 'MMM d, yyyy')}</span>
              ) : (
                <span>No renewal required</span>
              )}
              <span>
                Seat Licenses: {seatsLimit > 0 ? seatsLimit.toLocaleString() : '—'} (
                {Math.max(0, seatsUsed)} used)
              </span>
              <span>Owner: {userName}</span>
            </div>
          </div>

          <div className='flex w-full flex-col gap-2 sm:w-auto sm:min-w-[200px]'>
            <Link href='/#price' className='qx-btn-primary inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm'>
              <Zap className='h-4 w-4' />
              Change Plan
            </Link>
            <button
              type='button'
              onClick={handleManageSubscription}
              disabled={isCreatingPortalSession || !paid}
              className='qx-btn-ghost inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm disabled:opacity-50'
            >
              Manage Billing Details
            </button>
            <button
              type='button'
              onClick={handleManageSubscription}
              disabled={isCreatingPortalSession || !paid}
              className='inline-flex items-center justify-center gap-2 px-4 py-2 text-xs text-[var(--qx-danger)] disabled:opacity-40'
            >
              <X className='h-3.5 w-3.5' />
              Cancel Subscription
            </button>
          </div>
        </div>
      </section>

      {tab === 'usage' ? (
        <>
          {/* Usage allocation */}
          <div className='mb-3 flex flex-wrap items-center justify-between gap-2'>
            <h2 className='text-xs font-semibold uppercase tracking-[0.14em] text-[var(--qx-muted)]'>
              Autonomous Usage Allocation · Realtime
            </h2>
            <span className='text-xs text-[var(--qx-muted)]'>
              {daysLeft != null
                ? `Quotas cycle in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`
                : 'Free-tier quotas refresh monthly'}
            </span>
          </div>

          <div className='mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4'>
            <UsageMeterCard
              icon={Sparkles}
              title='AI Messages Meter'
              used={totalAiUsed}
              total={totalAiLimit}
              unit='used'
              badge={
                totalAiLimit > 0
                  ? `${Math.max(0, 100 - (totalAiUsed / totalAiLimit) * 100).toFixed(2)}% Avail`
                  : 'Metered'
              }
              badgeTone='live'
              footer={hybridFooter}
              action={
                <Link href='/#price' className='text-[11px] font-medium text-[var(--qx-primary)]'>
                  View plans
                </Link>
              }
            />
            <UsageMeterCard
              icon={FolderOpen}
              title='Active Projects'
              used={totalProjectsUsed}
              total={totalProjectsLimit}
              unit='active'
              badge={totalProjectsLimit >= 1000 ? 'Scale Uncapped' : 'Project pool'}
              badgeTone='coral'
              footer={<span>{Math.max(0, totalProjectsLimit - totalProjectsUsed)} remaining</span>}
              action={
                <Link
                  href='/dashboard'
                  className='inline-flex items-center gap-1 text-[11px] font-medium text-[var(--qx-primary)]'
                >
                  <Plus className='h-3 w-3' />
                  Create Project
                </Link>
              }
            />
            <UsageMeterCard
              icon={Headphones}
              title='AI Voice Minutes'
              used={0}
              total={0}
              unit='min'
              badge='Coming soon'
              badgeTone='cyan'
              footer={<span>Receptionist suite (Phase 6)</span>}
              action={
                <span className='text-[11px] text-[var(--qx-muted)]'>Top up Min</span>
              }
            />
            <UsageMeterCard
              icon={Radar}
              title='SEO & Scraping Audits'
              used={0}
              total={0}
              unit='completed'
              badge='Coming soon'
              badgeTone='cyan'
              footer={<span>SEO Auto-Fixer (Phase 3)</span>}
              action={
                <Link
                  href='/dashboard?tab=seo'
                  className='text-[11px] font-medium text-[var(--qx-primary)]'
                >
                  Schedule Crawl
                </Link>
              }
            />
          </div>

          {/* Add-on */}
          <div className='qx-card mb-5 flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between'>
            <div>
              <div className='mb-2 flex flex-wrap items-center gap-2'>
                <h3 className='text-lg font-semibold'>Autonomous Scale Cluster Add-on</h3>
                <span className='qx-pill qx-pill-coral'>Recommended</span>
              </div>
              <ul className='flex flex-wrap gap-x-5 gap-y-1 text-sm text-[var(--qx-muted)]'>
                {['Zero Cold Starts', 'Unlimited Subdomains', 'Dedicated TAM Support'].map((f) => (
                  <li key={f} className='inline-flex items-center gap-1.5'>
                    <Check className='h-3.5 w-3.5 text-[var(--qx-success)]' />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
            <Link
              href='/#price'
              className='qx-btn-primary inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm'
            >
              <Rocket className='h-4 w-4' />
              Upgrade Add-ons
            </Link>
          </div>
        </>
      ) : null}

      {/* Payment + invoices (also shown on ledger tab primarily; always visible at bottom like mock) */}
      <div
        className={cn(
          'grid gap-4 lg:grid-cols-2',
          tab === 'ledger' ? 'mt-0' : ''
        )}
      >
        <div className='qx-card p-5'>
          <div className='mb-4 flex items-center justify-between'>
            <h3 className='text-xs font-semibold uppercase tracking-[0.12em] text-[var(--qx-muted)]'>
              Payment Method
            </h3>
            <button
              type='button'
              onClick={handleManageSubscription}
              disabled={isCreatingPortalSession}
              className='text-xs font-medium text-[var(--qx-primary)] disabled:opacity-50'
            >
              + Add Card
            </button>
          </div>

          <div className='relative overflow-hidden rounded-xl border border-[var(--qx-border)] bg-gradient-to-br from-[#252528] to-[#131315] p-5'>
            <div className='mb-8 flex items-center justify-between'>
              <CreditCard className='h-6 w-6 text-[var(--qx-muted)]' />
              <span className='text-[10px] font-semibold uppercase tracking-wider text-[var(--qx-muted)]'>
                {paid ? 'Stripe Customer' : 'No card on file'}
              </span>
            </div>
            <p className='font-mono text-lg tracking-[0.2em] text-[var(--qx-text)]'>
              •••• •••• •••• {paid ? '••••' : '----'}
            </p>
            <div className='mt-4 flex justify-between text-xs text-[var(--qx-muted)]'>
              <span className='uppercase'>{userName}</span>
              <span>{paid ? 'Managed in Stripe' : 'N/A'}</span>
            </div>
          </div>

          <div className='mt-4 flex items-center justify-between gap-2 rounded-lg border border-[var(--qx-border)] bg-[var(--qx-bg)] px-3 py-2'>
            <div className='flex min-w-0 items-center gap-2'>
              <Mail className='h-3.5 w-3.5 shrink-0 text-[var(--qx-muted)]' />
              <span className='truncate text-xs'>{userEmail || 'Billing email'}</span>
            </div>
            <button
              type='button'
              onClick={handleManageSubscription}
              disabled={isCreatingPortalSession || !paid}
              className='shrink-0 text-[11px] font-medium text-[var(--qx-primary)] disabled:opacity-40'
            >
              Edit
            </button>
          </div>
          {!paid ? (
            <p className='mt-3 text-[11px] text-[var(--qx-muted)]'>
              Upgrade to a paid plan to attach a payment method via Stripe Customer Portal.
            </p>
          ) : null}
        </div>

        <div className='qx-card p-5'>
          <div className='mb-4 flex items-center justify-between gap-2'>
            <h3 className='text-xs font-semibold uppercase tracking-[0.12em] text-[var(--qx-muted)]'>
              Invoice History
            </h3>
            <button
              type='button'
              onClick={handleManageSubscription}
              disabled={isCreatingPortalSession || !paid}
              className='inline-flex items-center gap-1 text-xs font-medium text-[var(--qx-primary)] disabled:opacity-40'
            >
              <Download className='h-3.5 w-3.5' />
              Open in Stripe
            </button>
          </div>

          {paid ? (
            <div className='space-y-3'>
              <div className='flex items-start gap-3 rounded-lg border border-[var(--qx-border)] bg-[var(--qx-bg)] p-3'>
                <FileText className='mt-0.5 h-4 w-4 text-[var(--qx-primary)]' />
                <div className='min-w-0 flex-1'>
                  <p className='text-sm font-medium'>{displayName}</p>
                  <p className='text-xs text-[var(--qx-muted)]'>
                    Statements and receipts are issued by Stripe. Open the portal to download PDFs
                    and tax archives.
                  </p>
                </div>
                <span className='qx-pill qx-pill-live shrink-0'>Portal</span>
              </div>
              <p className='text-[11px] text-[var(--qx-muted)]'>
                Showing live billing via Stripe Customer Portal for compliance exports.
              </p>
            </div>
          ) : (
            <div className='flex flex-col items-center justify-center gap-2 py-10 text-center'>
              <FileText className='h-8 w-8 text-[var(--qx-muted)] opacity-40' />
              <p className='text-sm font-medium'>No invoices yet</p>
              <p className='max-w-xs text-xs text-[var(--qx-muted)]'>
                Free workspaces do not generate settlements. Upgrade to enable invoice history.
              </p>
              <Link href='/#price' className='qx-btn-primary mt-2 px-4 py-2 text-xs'>
                View Plans
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
