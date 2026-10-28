/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * integrations-hub.tsx — Integrations & Connectors (Obsidian Kinetic)
 */

'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Activity,
  Database,
  ExternalLink,
  Headphones,
  Loader2,
  Mail,
  MessageCircle,
  Network,
  Plug,
  Radio,
  RefreshCw,
  Server,
  Share2,
  Sparkles,
} from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@quickxbuild/ui/components/avatar'
import { cn } from '@quickxbuild/ui/lib/utils'
import { useTRPC } from '@/trpc/client'
import * as m from '@/paraglide/messages'
import '../dashboard-kinetic.css'

function createCenteredPopup(url: string, name: string, width: number, height: number) {
  const left = window.screen.width / 2 - width / 2
  const top = window.screen.height / 2 - height / 2
  return window.open(
    url,
    name,
    `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
  )
}

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill='currentColor' viewBox='0 0 24 24' aria-hidden>
      <path
        fillRule='evenodd'
        d='M12 2C6.477 2 2 6.477 2 12c0 4.418 2.867 8.166 6.839 9.489.5.092.682-.217.682-.483 0-.237-.009-.868-.014-1.703-2.782.604-3.369-1.342-3.369-1.342-.454-1.153-1.11-1.461-1.11-1.461-.908-.62.069-.608.069-.608 1.004.07 1.532 1.032 1.532 1.032.892 1.529 2.341 1.088 2.91.832.092-.646.35-1.088.636-1.339-2.221-.253-4.555-1.111-4.555-4.945 0-1.092.39-1.987 1.029-2.686-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.025A9.564 9.564 0 0 1 12 6.844c.85.004 1.705.115 2.504.337 1.909-1.295 2.748-1.025 2.748-1.025.546 1.378.202 2.397.1 2.65.64.699 1.028 1.594 1.028 2.686 0 3.842-2.337 4.688-4.566 4.937.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.744 0 .268.18.579.688.481C19.135 20.162 22 16.418 22 12c0-5.523-4.477-10-10-10z'
        clipRule='evenodd'
      />
    </svg>
  )
}

type StatusTone = 'live' | 'cyan' | 'coral' | 'muted' | 'magenta' | 'warn'

function StatusPill({ label, tone }: { label: string; tone: StatusTone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide',
        tone === 'live' && 'bg-[rgba(34,197,94,0.15)] text-[var(--qx-success)]',
        tone === 'cyan' && 'bg-[rgba(56,189,248,0.15)] text-[var(--qx-cyan)]',
        tone === 'coral' && 'bg-[rgba(255,115,71,0.15)] text-[var(--qx-primary)]',
        tone === 'magenta' && 'bg-[rgba(236,72,153,0.15)] text-[#f472b6]',
        tone === 'warn' && 'bg-[rgba(234,179,8,0.15)] text-[var(--qx-warning)]',
        tone === 'muted' && 'bg-[rgba(161,161,170,0.15)] text-[var(--qx-muted)]'
      )}
    >
      {(tone === 'live' || tone === 'cyan' || tone === 'magenta') && (
        <span
          className={cn(
            'size-1.5 rounded-full',
            tone === 'live' && 'bg-[var(--qx-success)] shadow-[0_0_6px_rgba(34,197,94,0.8)]',
            tone === 'cyan' && 'bg-[var(--qx-cyan)]',
            tone === 'magenta' && 'bg-[#f472b6]'
          )}
        />
      )}
      {label}
    </span>
  )
}

type PipelineCard = {
  id: string
  title: string
  description: string
  icon: typeof MessageCircle
  status: string
  tone: StatusTone
  metrics: { label: string; value: string }[]
  action: { label: string; href?: string; external?: boolean; primary?: boolean; disabled?: boolean }
  countsAsActive?: boolean
}

const PIPELINE: PipelineCard[] = [
  {
    id: 'whatsapp',
    title: 'WhatsApp CRM & Lead Inbound',
    description: 'Session-aware receptionist bridge for inbound leads and follow-ups.',
    icon: MessageCircle,
    status: 'Coming soon',
    tone: 'muted',
    metrics: [
      { label: 'Suite phase', value: 'Phase 6' },
      { label: 'Channel', value: 'WhatsApp Business' },
    ],
    action: { label: 'Configure Bot →', href: '/dashboard?tab=receptionist', disabled: false },
  },
  {
    id: 'linkedin',
    title: 'LinkedIn Lead Bot & Scraper',
    description: 'Campaign sync and acceptance tracking for outbound social growth.',
    icon: Share2,
    status: 'Coming soon',
    tone: 'muted',
    metrics: [
      { label: 'Suite phase', value: 'Phase 5' },
      { label: 'OAuth', value: 'Queued' },
    ],
    action: { label: 'Manage OAuth →', href: '/dashboard?tab=social' },
  },
  {
    id: 'tiktok',
    title: 'TikTok Ads & Viral Hook Scraper',
    description: 'Index creative hooks and cadence for social marketing experiments.',
    icon: Radio,
    status: 'Coming soon',
    tone: 'muted',
    metrics: [
      { label: 'Suite phase', value: 'Phase 5' },
      { label: 'Crawl', value: 'Not enabled' },
    ],
    action: { label: 'Settings →', href: '/dashboard?tab=social' },
  },
  {
    id: 'meta',
    title: 'Meta / Facebook Graph API',
    description: 'Pages, ads, and messaging graph for multi-channel campaigns.',
    icon: Network,
    status: 'Pending Auth',
    tone: 'warn',
    metrics: [
      { label: 'Token', value: 'Not connected' },
      { label: 'Suite phase', value: 'Phase 5' },
    ],
    action: { label: 'Connect Meta', primary: true, disabled: true },
  },
  {
    id: 'vercel',
    title: 'Vercel Hosting & Domain Relay',
    description: 'Edge deploy and custom domain relay for published QuickXBuild apps.',
    icon: Server,
    status: 'Platform ready',
    tone: 'cyan',
    metrics: [
      { label: 'Deploy', value: 'Via project IDE' },
      { label: 'Domains', value: 'Per project' },
    ],
    action: { label: 'Manage DNS →', href: '/dashboard' },
    countsAsActive: true,
  },
  {
    id: 'voice',
    title: 'Twilio & LiveKit WebRTC Voice',
    description: 'SIP trunks and realtime voice for the AI receptionist cluster.',
    icon: Headphones,
    status: 'Coming soon',
    tone: 'muted',
    metrics: [
      { label: 'Suite phase', value: 'Phase 6' },
      { label: 'Latency', value: '—' },
    ],
    action: { label: 'Voice Trunks →', href: '/dashboard?tab=receptionist' },
  },
  {
    id: 'resend',
    title: 'Resend Smart SMTP Dispatcher',
    description: 'Transactional mail for OTP, invites, and growth sequences.',
    icon: Mail,
    status: 'Platform SMTP',
    tone: 'live',
    metrics: [
      { label: 'Auth mail', value: 'QuickXBuild branded' },
      { label: 'Sequences', value: 'Phase 4' },
    ],
    action: { label: 'Inboxes →', href: '/dashboard?tab=crm' },
    countsAsActive: true,
  },
  {
    id: 'data',
    title: 'Managed Data Store',
    description: 'Workspace data plane for leads, threads, and automation runs.',
    icon: Database,
    status: 'Coming soon',
    tone: 'muted',
    metrics: [
      { label: 'Suite phase', value: 'Phase 1' },
      { label: 'Schema', value: 'Planned' },
    ],
    action: { label: 'Schema Sync →', href: '/dashboard' },
  },
  {
    id: 'stripe',
    title: 'Stripe Billing & Metered Token API',
    description: 'Subscriptions, portal invoices, and credit metering for the workspace.',
    icon: Sparkles,
    status: 'Billing live',
    tone: 'live',
    metrics: [
      { label: 'Portal', value: 'Customer Portal' },
      { label: 'Credits', value: 'Workspace gated' },
    ],
    action: { label: 'Stripe Vault →', href: '/dashboard/billing' },
    countsAsActive: true,
  },
]

export function IntegrationsHub() {
  const trpc = useTRPC()
  const [isAuthenticating, setIsAuthenticating] = useState(false)
  const [probeAt, setProbeAt] = useState<Date | null>(null)

  const {
    data: connectionStatus,
    isLoading: isCheckingConnection,
    error: connectionError,
    refetch: refetchConnection,
    isFetching,
  } = useQuery({
    ...trpc.github.getConnectionStatus.queryOptions({}),
    retry: false,
  })

  const isConnected = !!(
    connectionStatus &&
    typeof connectionStatus === 'object' &&
    'isConnected' in connectionStatus &&
    connectionStatus.isConnected === true
  )

  const { data: githubUser, isLoading: isLoadingUser } = useQuery({
    ...trpc.github.getUser.queryOptions({}),
    enabled: isConnected,
    retry: false,
    throwOnError: false,
  })

  const getOAuthUrlMutation = useMutation(
    trpc.github.getOAuthUrl.mutationOptions({
      onSuccess: (data) => {
        const popup = createCenteredPopup(data.oauthUrl, 'github-oauth', 600, 700)
        if (!popup) {
          setIsAuthenticating(false)
          toast.error(m['dashboard.integrations.github.messages.popup_blocked']())
          return
        }
        popup.focus()
        const checkClosed = setInterval(() => {
          if (popup.closed) {
            clearInterval(checkClosed)
            setIsAuthenticating(false)
            setTimeout(() => refetchConnection(), 1000)
          }
        }, 1000)
        setTimeout(() => {
          clearInterval(checkClosed)
          setIsAuthenticating(false)
        }, 5 * 60 * 1000)
      },
      onError: (error) => {
        toast.error(error.message || m['dashboard.integrations.github.messages.oauth_failed']())
        setIsAuthenticating(false)
      },
    })
  )

  const handleGitHubAuth = () => {
    setIsAuthenticating(true)
    getOAuthUrlMutation.mutate({})
  }

  const handleHealthProbe = async () => {
    setProbeAt(new Date())
    await refetchConnection()
    toast.success('Health probe complete')
  }

  const pipelineActive = PIPELINE.filter((c) => c.countsAsActive).length
  const activeNodes = (isConnected ? 1 : 0) + pipelineActive
  const pendingAuth = PIPELINE.filter((c) => c.tone === 'warn' || c.status === 'Pending Auth').length
  const operational = PIPELINE.filter((c) => c.countsAsActive).length + (isConnected ? 1 : 0)

  const targetLabel = useMemo(() => {
    if (githubUser?.login) return `quickxbuild-labs / ${githubUser.login}`
    if (isConnected) return 'GitHub connected'
    return 'No organization linked'
  }, [githubUser, isConnected])

  const githubLoading = isCheckingConnection || isLoadingUser || isAuthenticating

  return (
    <div className='dashboard-kinetic px-3 sm:px-4 lg:px-6'>
      {/* Header */}
      <div className='mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between'>
        <div>
          <div className='mb-2 flex flex-wrap items-center gap-2'>
            <Plug className='h-6 w-6 text-[var(--qx-primary)]' />
            <h1 className='text-[28px] font-semibold tracking-tight sm:text-[32px]'>
              Integrations &amp; Connectors
            </h1>
            <StatusPill label={`${activeNodes} Active Nodes`} tone='cyan' />
          </div>
          <p className='max-w-3xl text-sm text-[var(--qx-muted)]'>
            Connect external developer codebases, high-velocity ad scrapers, multi-channel AI
            receptionist nodes, and messaging clusters into your autonomous workspace pipeline.
          </p>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <span className='qx-pill qx-pill-cyan'>
            <Activity className='h-3 w-3' />
            Auto-Relay: ready
          </span>
          <button
            type='button'
            onClick={handleHealthProbe}
            disabled={isFetching}
            className='qx-btn-ghost inline-flex items-center gap-2 px-3 py-1.5 text-xs'
          >
            {isFetching ? <Loader2 className='h-3.5 w-3.5 animate-spin' /> : <RefreshCw className='h-3.5 w-3.5' />}
            Health Probe
          </button>
        </div>
      </div>

      {/* Core infrastructure */}
      <div className='mb-3 flex items-center justify-between gap-2'>
        <div className='flex items-center gap-2'>
          <span className='flex h-6 w-6 items-center justify-center rounded-md bg-[rgba(255,115,71,0.15)] text-[var(--qx-primary)]'>
            <GitHubIcon className='h-3.5 w-3.5' />
          </span>
          <h2 className='text-sm font-semibold'>Core Infrastructure Node</h2>
        </div>
        <span className='text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--qx-muted)]'>
          Primary VCS Target
        </span>
      </div>

      <section className='qx-card mb-6 p-5'>
        <div className='flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between'>
          <div className='flex min-w-0 flex-1 gap-4'>
            <div className='flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--qx-surface-2)]'>
              <GitHubIcon className='h-6 w-6' />
            </div>
            <div className='min-w-0 flex-1'>
              <div className='mb-1 flex flex-wrap items-center gap-2'>
                <h3 className='text-lg font-semibold'>GitHub</h3>
                {githubLoading ? (
                  <StatusPill label='Checking…' tone='cyan' />
                ) : isConnected ? (
                  <StatusPill label='Connected' tone='live' />
                ) : (
                  <StatusPill label='Disconnected' tone='muted' />
                )}
              </div>
              <p className='text-sm text-[var(--qx-muted)]'>
                Connect your GitHub organization to provision autonomous micro-repos and sync commit
                hooks into QuickXBuild.
              </p>

              {isConnected && githubUser ? (
                <div className='mt-4 flex flex-wrap items-center gap-4'>
                  <Avatar className='h-10 w-10'>
                    <AvatarImage src={githubUser.avatar_url} alt={githubUser.login} />
                    <AvatarFallback>{githubUser.login?.slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className='text-xs text-[var(--qx-muted)]'>
                    <p>
                      Active Target:{' '}
                      <span className='font-medium text-[var(--qx-text)]'>{targetLabel}</span>
                    </p>
                    <p className='mt-1'>
                      Auto-Commit Sync: <span className='text-[var(--qx-success)]'>Enabled</span>
                      {' · '}
                      Repos: {githubUser.public_repos ?? '—'}
                    </p>
                  </div>
                </div>
              ) : null}

              {connectionError && !githubLoading ? (
                <p className='mt-3 text-xs text-[var(--qx-danger)]'>
                  {connectionError.message || m['dashboard.integrations.github.connection_failed']()}
                </p>
              ) : null}

              {probeAt ? (
                <p className='mt-2 text-[11px] text-[var(--qx-muted)]'>
                  Last probe {probeAt.toLocaleTimeString()}
                </p>
              ) : null}
            </div>
          </div>

          <div className='flex w-full flex-col gap-2 sm:w-auto sm:min-w-[160px]'>
            {isConnected ? (
              <>
                <a
                  href={githubUser?.html_url || 'https://github.com'}
                  target='_blank'
                  rel='noreferrer'
                  className='qx-btn-ghost inline-flex items-center justify-center gap-2 px-4 py-2 text-sm'
                >
                  Switch Repo
                  <ExternalLink className='h-3.5 w-3.5' />
                </a>
                <button
                  type='button'
                  onClick={handleGitHubAuth}
                  disabled={isAuthenticating}
                  className='qx-btn-primary inline-flex items-center justify-center gap-2 px-4 py-2 text-sm'
                >
                  {isAuthenticating ? <Loader2 className='h-4 w-4 animate-spin' /> : null}
                  Re-authenticate
                </button>
              </>
            ) : (
              <button
                type='button'
                onClick={handleGitHubAuth}
                disabled={isAuthenticating || isCheckingConnection}
                className='qx-btn-primary inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm'
              >
                {isAuthenticating ? (
                  <Loader2 className='h-4 w-4 animate-spin' />
                ) : (
                  <GitHubIcon className='h-4 w-4' />
                )}
                {m['dashboard.integrations.github.connect_github']()}
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Pipeline grid */}
      <div className='mb-3 flex flex-wrap items-center justify-between gap-2'>
        <h2 className='text-sm font-semibold'>Autonomous AI &amp; Marketing Pipeline</h2>
        <span className='text-xs text-[var(--qx-muted)]'>
          {operational} Operational · {pendingAuth} Pending Auth
        </span>
      </div>

      <div className='mb-6 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3'>
        {PIPELINE.map((card) => {
          const Icon = card.icon
          return (
            <div key={card.id} className='qx-card flex flex-col p-4'>
              <div className='mb-3 flex items-start justify-between gap-2'>
                <div className='flex items-center gap-2.5'>
                  <div className='flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--qx-surface-2)] text-[var(--qx-primary)]'>
                    <Icon className='h-4 w-4' />
                  </div>
                  <h3 className='text-sm font-semibold leading-snug'>{card.title}</h3>
                </div>
                <StatusPill label={card.status} tone={card.tone} />
              </div>
              <p className='mb-3 text-xs text-[var(--qx-muted)]'>{card.description}</p>
              <dl className='mb-4 space-y-1.5 text-[11px]'>
                {card.metrics.map((metric) => (
                  <div key={metric.label} className='flex justify-between gap-2'>
                    <dt className='text-[var(--qx-muted)]'>{metric.label}</dt>
                    <dd className='font-medium tabular-nums text-[var(--qx-text)]'>{metric.value}</dd>
                  </div>
                ))}
              </dl>
              <div className='mt-auto'>
                {card.action.primary ? (
                  <button
                    type='button'
                    disabled={card.action.disabled}
                    className='qx-btn-primary inline-flex w-full items-center justify-center gap-2 px-3 py-2 text-xs disabled:opacity-50'
                  >
                    {card.action.label}
                    <ExternalLink className='h-3 w-3' />
                  </button>
                ) : card.action.href ? (
                  <Link
                    href={card.action.href}
                    className='text-xs font-medium text-[var(--qx-primary)] hover:underline'
                  >
                    {card.action.label}
                  </Link>
                ) : (
                  <span className='text-xs text-[var(--qx-muted)]'>{card.action.label}</span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Bridges */}
      <section className='qx-card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between'>
        <div>
          <div className='mb-1 flex flex-wrap items-center gap-2'>
            <h3 className='text-sm font-semibold'>Incoming AI Bridges &amp; Webhooks</h3>
            <StatusPill label='In Review' tone='warn' />
          </div>
          <p className='text-xs text-[var(--qx-muted)]'>
            Discord, Zapier, and Slack bridges are queued for deployment after the channel data plane
            (Phase 1).
          </p>
        </div>
        <div className='flex items-center gap-3'>
          <div className='flex -space-x-2'>
            {['D', 'Z', 'S'].map((letter) => (
              <span
                key={letter}
                className='flex h-8 w-8 items-center justify-center rounded-full border border-[var(--qx-border)] bg-[var(--qx-surface-2)] text-[10px] font-semibold'
              >
                {letter}
              </span>
            ))}
          </div>
          <button
            type='button'
            className='qx-btn-ghost px-3 py-2 text-xs'
            onClick={() => toast.message('Vote recorded — bridges unlock with Phase 1 connectors')}
          >
            + Vote for Next Bridge
          </button>
        </div>
      </section>
    </div>
  )
}
