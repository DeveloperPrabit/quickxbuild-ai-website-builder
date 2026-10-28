/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * command-center.tsx — Enterprise Growth & AI Engine dashboard (DESIGN.md)
 */

'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  Bot,
  Globe2,
  Headphones,
  Mail,
  Monitor,
  Phone,
  Plus,
  Radar,
  Search,
  Share2,
  Sparkles,
  Wand2,
} from 'lucide-react'
import { cn } from '@quickxbuild/ui/lib/utils'
import { useTRPC } from '@/trpc/client'
import { CreateProjectDialog } from './create-project-dialog'
import { ProjectCreateButton } from './ui/project-create-button'
import { BrandMark } from '@/components/common/logo/BrandMark'
import './dashboard-kinetic.css'

type TabId = 'overview' | 'receptionist' | 'crm' | 'social' | 'studio' | 'seo'

const TAB_LABELS: Record<TabId, string> = {
  overview: 'Overview',
  receptionist: 'AI Receptionist',
  crm: 'Email & CRM',
  social: 'Social Marketing',
  studio: 'Website & Studio',
  seo: 'SEO Auto-Fixer',
}

function parseTab(value: string | null): TabId {
  if (
    value === 'receptionist' ||
    value === 'crm' ||
    value === 'social' ||
    value === 'studio' ||
    value === 'seo'
  ) {
    return value
  }
  return 'overview'
}

const CHANNELS = [
  'WhatsApp',
  'TikTok',
  'LinkedIn',
  'Facebook',
  'Instagram',
  'X / Twitter',
  'Email SMTP',
]

const MODULES = [
  {
    title: 'AI Website Generator',
    desc: 'Prompt-to-production builds with visual edit + deploy.',
    icon: Wand2,
    progress: 88,
    badge: 'Active',
    href: '/dashboard',
  },
  {
    title: 'SEO Auto-Fixer',
    desc: 'Crawl, score, and patch metadata / sitemap issues.',
    icon: Radar,
    progress: 72,
    badge: '92/110',
    href: '/dashboard/integrations',
  },
  {
    title: 'Competitor Scraper',
    desc: 'Monitor rival launches, pricing, and creative shifts.',
    icon: Search,
    progress: 64,
    badge: 'Live',
    href: '/dashboard/integrations',
  },
  {
    title: 'Cold Outreach Drip',
    desc: 'Multi-step sequences with reply-aware pacing.',
    icon: Mail,
    progress: 84,
    badge: '84.2% open',
    href: '/dashboard/integrations',
  },
]

export function CommandCenter() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tab = parseTab(searchParams.get('tab'))
  const [createOpen, setCreateOpen] = useState(false)
  const trpc = useTRPC()
  const {
    data: projects,
    isPending: projectsPending,
    isError: projectsError,
  } = useQuery(trpc.project.list.queryOptions({}))

  const setTab = (next: TabId) => {
    if (next === 'overview') {
      router.push('/dashboard')
      return
    }
    router.push(`/dashboard?tab=${next}`)
  }

  const projectList = Array.isArray(projects) ? projects : []
  const activeCount = projectList.filter((p) => p.isActive !== false).length

  const metrics = useMemo(
    () => [
      {
        label: 'Active AI Agents',
        value: `${Math.min(activeCount || 1, 5)} / 5`,
        hint: 'ALL OPERATIONAL',
        tone: 'success' as const,
      },
      {
        label: 'Projects Live',
        value: String(projectList.length),
        hint: activeCount ? `+${activeCount} active` : 'Ready to launch',
        tone: 'coral' as const,
      },
      {
        label: 'SEO Health',
        value: '92/110',
        hint: 'Composite score',
        tone: 'cyan' as const,
      },
      {
        label: 'Outreach Velocity',
        value: '3.8k',
        hint: 'sent / day (sim)',
        tone: 'coral' as const,
      },
    ],
    [activeCount, projectList.length]
  )

  return (
    <div className='dashboard-kinetic px-3 sm:px-4 lg:px-6'>
      {/* Banner */}
      <section className='qx-card mb-5 flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between'>
        <div className='flex items-start gap-4'>
          <BrandMark className='h-12 w-12' />
          <div>
            <div className='qx-pill qx-pill-coral mb-2'>AUTONOMOUS CLUSTER V3.4</div>
            <h1 className='text-[28px] font-semibold tracking-tight text-[var(--qx-text)] sm:text-[36px] sm:leading-[44px]'>
              Enterprise Growth &amp; AI Engine
            </h1>
            <p className='mt-1 text-sm text-[var(--qx-muted)]'>
              QuickXBuild command center — websites, SEO, outreach, and live AI receptionist in one
              kinetic surface.
            </p>
          </div>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <span className='qx-pill qx-pill-live'>
            <span className='qx-live-dot' />
            All Systems Live 99.98%
          </span>
          <ProjectCreateButton onClick={() => setCreateOpen(true)} />
        </div>
      </section>

      {/* Tabs — mirrors Autonomous Core sidebar */}
      <div className='mb-4 flex flex-wrap gap-1 border-b border-[var(--qx-border)] pb-1'>
        {(Object.keys(TAB_LABELS) as TabId[]).map((id) => (
          <button
            key={id}
            type='button'
            onClick={() => setTab(id)}
            className={cn(
              'rounded-md px-3 py-2 text-sm font-medium transition-colors',
              tab === id
                ? 'bg-[rgba(255,115,71,0.15)] text-[var(--qx-primary)]'
                : 'text-[var(--qx-muted)] hover:text-[var(--qx-text)]'
            )}
          >
            {TAB_LABELS[id]}
          </button>
        ))}
      </div>

      {tab !== 'overview' ? (
        <section className='qx-card mb-5 flex flex-col items-start gap-3 p-6 sm:flex-row sm:items-center sm:justify-between'>
          <div className='flex items-start gap-3'>
            {tab === 'receptionist' && <Headphones className='mt-0.5 h-5 w-5 text-[var(--qx-primary)]' />}
            {tab === 'crm' && <Mail className='mt-0.5 h-5 w-5 text-[var(--qx-primary)]' />}
            {tab === 'social' && <Share2 className='mt-0.5 h-5 w-5 text-[var(--qx-primary)]' />}
            {tab === 'studio' && <Monitor className='mt-0.5 h-5 w-5 text-[var(--qx-primary)]' />}
            {tab === 'seo' && <Radar className='mt-0.5 h-5 w-5 text-[var(--qx-primary)]' />}
            <div>
              <h2 className='text-lg font-semibold'>{TAB_LABELS[tab]}</h2>
              <p className='mt-1 text-sm text-[var(--qx-muted)]'>
                Module console for {TAB_LABELS[tab]}. Connect channels from Integrations to go live.
              </p>
            </div>
          </div>
          <Link href='/dashboard/integrations' className='qx-btn-primary px-4 py-2 text-sm'>
            Configure
          </Link>
        </section>
      ) : null}

      {/* Channels */}
      <div className='mb-5 flex flex-wrap gap-2'>
        {CHANNELS.map((name) => (
          <span key={name} className='qx-pill qx-pill-cyan'>
            <span className='qx-live-dot' />
            {name}
          </span>
        ))}
      </div>

      <div className='grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]'>
        <div className='flex flex-col gap-5'>
          {/* Metrics */}
          <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4'>
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
                    m.tone === 'cyan' && 'text-[var(--qx-cyan)]',
                    m.tone === 'coral' && 'text-[var(--qx-primary)]'
                  )}
                >
                  {m.hint}
                </p>
              </div>
            ))}
          </div>

          {/* Modules */}
          <div>
            <div className='mb-3 flex items-center gap-2'>
              <Sparkles className='h-4 w-4 text-[var(--qx-primary)]' />
              <h2 className='text-lg font-semibold tracking-tight'>Unified AI Modules</h2>
            </div>
            <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
              {MODULES.map((mod) => {
                const Icon = mod.icon
                return (
                  <Link key={mod.title} href={mod.href} className='qx-card block p-4'>
                    <div className='flex items-start justify-between gap-3'>
                      <div className='flex items-center gap-3'>
                        <div className='flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--qx-surface-2)] text-[var(--qx-primary)]'>
                          <Icon className='h-5 w-5' />
                        </div>
                        <div>
                          <h3 className='text-[18px] font-semibold leading-6'>{mod.title}</h3>
                          <p className='mt-1 text-sm text-[var(--qx-muted)]'>{mod.desc}</p>
                        </div>
                      </div>
                      <span className='qx-pill qx-pill-coral shrink-0'>{mod.badge}</span>
                    </div>
                    <div className='mt-4'>
                      <div className='mb-1 flex justify-between text-xs text-[var(--qx-muted)]'>
                        <span>Pipeline</span>
                        <span className='tabular-nums'>{mod.progress}%</span>
                      </div>
                      <div className='qx-progress'>
                        <span style={{ width: `${mod.progress}%` }} />
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>

          {/* Active projects */}
          <div>
            <div className='mb-3 flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                <Globe2 className='h-4 w-4 text-[var(--qx-cyan)]' />
                <h2 className='text-lg font-semibold tracking-tight'>Active Projects</h2>
              </div>
              <button
                type='button'
                onClick={() => setCreateOpen(true)}
                className='qx-btn-ghost inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium'
              >
                <Plus className='h-3.5 w-3.5' />
                New
              </button>
            </div>
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3'>
              {projectsPending ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className='qx-card animate-pulse overflow-hidden'>
                    <div className='aspect-[16/10] bg-[var(--qx-surface-2)]' />
                    <div className='space-y-2 p-3'>
                      <div className='h-4 w-2/3 rounded bg-[var(--qx-surface-2)]' />
                      <div className='h-3 w-full rounded bg-[var(--qx-surface-2)]' />
                    </div>
                  </div>
                ))
              ) : projectsError ? (
                <div className='qx-card col-span-full p-6 text-center text-sm text-[var(--qx-muted)]'>
                  Could not load projects. Check database connection and refresh.
                </div>
              ) : projectList.length === 0 ? (
                <button
                  type='button'
                  onClick={() => setCreateOpen(true)}
                  className='qx-card col-span-full flex flex-col items-center justify-center gap-2 p-8 text-center'
                >
                  <BrandMark className='h-10 w-10' />
                  <p className='font-medium'>No projects yet</p>
                  <p className='text-sm text-[var(--qx-muted)]'>
                    Create your first QuickXBuild app to populate this rail.
                  </p>
                </button>
              ) : (
                projectList.slice(0, 6).map((project) => (
                  <Link
                    key={project.id}
                    href={`/project/${project.id}`}
                    className='qx-card overflow-hidden'
                  >
                    <div className='aspect-[16/10] bg-[var(--qx-surface-2)]'>
                      {project.previewImageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={project.previewImageUrl}
                          alt=''
                          className='h-full w-full object-cover'
                        />
                      ) : (
                        <div className='flex h-full items-center justify-center text-[var(--qx-muted)]'>
                          <Bot className='h-8 w-8 opacity-40' />
                        </div>
                      )}
                    </div>
                    <div className='p-3'>
                      <div className='flex items-center justify-between gap-2'>
                        <h3 className='truncate text-sm font-semibold'>{project.name}</h3>
                        <span className='qx-pill qx-pill-live'>
                          <span className='qx-live-dot' />
                          {project.isActive === false ? 'Idle' : 'Live'}
                        </span>
                      </div>
                      <p className='mt-1 line-clamp-2 text-xs text-[var(--qx-muted)]'>
                        {project.initialMessage || 'QuickXBuild generated application'}
                      </p>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>

          {/* Synchronizer */}
          <div className='qx-card relative overflow-hidden p-5'>
            <div
              className='pointer-events-none absolute inset-0 opacity-40'
              style={{
                background:
                  'radial-gradient(600px 200px at 10% 0%, rgba(255,115,71,0.25), transparent 60%)',
              }}
            />
            <div className='relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between'>
              <div className='flex items-start gap-3'>
                <BrandMark className='h-11 w-11' />
                <div>
                  <h2 className='text-lg font-semibold'>QuickXBuild Synchronizer</h2>
                  <p className='mt-1 max-w-xl text-sm text-[var(--qx-muted)]'>
                    Keep preview, deploy, and agent pipelines aligned. Open the engine console to
                    inspect sync streams and documentation.
                  </p>
                </div>
              </div>
              <div className='flex flex-wrap gap-2'>
                <Link href='/dashboard/integrations' className='qx-btn-primary px-4 py-2 text-sm'>
                  Open Engine Console
                </Link>
                <a
                  href='https://docs.quickxbuild.dev'
                  target='_blank'
                  rel='noreferrer'
                  className='qx-btn-ghost px-4 py-2 text-sm'
                >
                  Documentation
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* Right rail */}
        <aside className='flex flex-col gap-4'>
          <div className='qx-card p-4'>
            <div className='mb-3 flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                <Phone className='h-4 w-4 text-[var(--qx-primary)]' />
                <h3 className='text-sm font-semibold'>AI Voice Receptionist</h3>
              </div>
              <span className='qx-pill qx-pill-live'>
                <span className='qx-live-dot' />
                LIVE
              </span>
            </div>
            <div className='mb-3 flex h-16 items-end gap-1 rounded-lg bg-[var(--qx-surface-2)] px-3 py-2'>
              {Array.from({ length: 24 }).map((_, i) => (
                <span
                  key={i}
                  className='flex-1 rounded-sm bg-gradient-to-t from-[#ff7347] to-[#ffb59f]'
                  style={{ height: `${30 + ((i * 37) % 60)}%` }}
                />
              ))}
            </div>
            <p className='text-xs text-[var(--qx-muted)]'>
              Duration <span className='tabular-nums text-[var(--qx-text)]'>01:42</span>
            </p>
            <p className='mt-2 rounded-md border border-[var(--qx-border)] bg-[var(--qx-bg)] p-2 text-xs text-[var(--qx-muted)]'>
              Live transcript: “Thanks for calling — I can book a demo or route you to sales…”
            </p>
            <div className='mt-3 flex gap-2'>
              <button type='button' className='qx-btn-ghost flex-1 py-1.5 text-xs'>
                Mute AI
              </button>
              <button type='button' className='qx-btn-primary flex-1 py-1.5 text-xs'>
                Take Over
              </button>
            </div>
          </div>

          <div className='qx-card p-4'>
            <div className='mb-3 flex items-center gap-2'>
              <Activity className='h-4 w-4 text-[var(--qx-cyan)]' />
              <h3 className='text-sm font-semibold'>Code Sync Stream</h3>
            </div>
            <pre className='max-h-48 overflow-auto rounded-lg bg-[#0e0e10] p-3 font-mono text-[11px] leading-5 text-[#a1a1aa]'>
{`$ quickx compile
✓ Optimizing SVG assets
✓ Applying workspace_billing gates
→ Preview hot-reload ready
→ Agent tools: list_dir, write_file
`}
            </pre>
          </div>

          <div className='qx-card p-4'>
            <h3 className='mb-3 text-sm font-semibold'>Qualified Lead Feed</h3>
            <ul className='space-y-3'>
              {[
                { name: 'Northwind Labs', tag: 'Enterprise', tone: 'coral' },
                { name: 'Atlas Retail', tag: 'Inbound Call', tone: 'live' },
                { name: 'Pulse Media', tag: 'Warm Lead', tone: 'cyan' },
              ].map((lead) => (
                <li
                  key={lead.name}
                  className='flex items-center justify-between gap-2 border-b border-[var(--qx-border)] pb-2 last:border-0'
                >
                  <div>
                    <p className='text-sm font-medium'>{lead.name}</p>
                    <p className='text-xs text-[var(--qx-muted)]'>Synced via QuickXBuild CRM</p>
                  </div>
                  <span
                    className={cn(
                      'qx-pill',
                      lead.tone === 'coral' && 'qx-pill-coral',
                      lead.tone === 'live' && 'qx-pill-live',
                      lead.tone === 'cyan' && 'qx-pill-cyan'
                    )}
                  >
                    {lead.tag}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>

      <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}
