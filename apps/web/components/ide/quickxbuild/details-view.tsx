/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * details-view.tsx — Main-pane run Details (Timeline + Changes) for one Agent Runtime run
 */

'use client'

import { DiffModeEnum } from '@git-diff-view/react'
import { cn } from '@quickxbuild/ui/lib/utils'
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Eye,
  FilePenLine,
  FilePlus2,
  Loader2,
  Sparkles,
  Terminal,
  XCircle,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { FileDiffView } from './filetree/file-diff-view'
import { type AgentRun, type RunStep, useAgentRunStore } from './hooks/use-agent-run-store'
import { useMainViewStore } from './hooks/use-main-view-store'

type DetailsTab = 'timeline' | 'changes'

function fileName(path: string) {
  return path.split('/').pop() || path
}

function formatElapsed(ms: number) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
}

function useElapsed(run: AgentRun | undefined) {
  const [now, setNow] = useState(() => Date.now())
  const running = run?.status === 'running'
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])
  if (!run) return 0
  return (run.endedAt ?? now) - run.startedAt
}

function StepIcon({ step }: { step: RunStep }) {
  if (step.status === 'running') {
    return <Loader2 className='h-3.5 w-3.5 animate-spin text-amber-500' />
  }
  if (step.status === 'failed') {
    return <XCircle className='h-3.5 w-3.5 text-red-500' />
  }
  switch (step.kind) {
    case 'thought':
      return <Sparkles className='h-3.5 w-3.5 text-violet-500' />
    case 'read':
      return <Eye className='h-3.5 w-3.5 text-sky-500' />
    case 'edit':
      return <FilePenLine className='h-3.5 w-3.5 text-emerald-500' />
    case 'terminal':
      return <Terminal className='h-3.5 w-3.5 text-emerald-600' />
    default:
      return <CheckCircle2 className='h-3.5 w-3.5 text-emerald-500' />
  }
}

function stepTitle(step: RunStep) {
  if (step.kind === 'thought' && step.status !== 'running' && step.durationMs) {
    if (!step.title.startsWith('Thought for')) {
      return `Thought for ${Math.max(1, Math.round(step.durationMs / 1000))}s`
    }
  }
  if (step.kind === 'edit' && step.path) {
    if (step.status === 'running') return `Editing ${fileName(step.path)}`
    if (step.status === 'done') return `Edited ${fileName(step.path)}`
    return `Edit failed: ${fileName(step.path)}`
  }
  return step.title
}

function TimelineRow({
  step,
  onOpenChange,
  hasChange,
}: {
  step: RunStep
  onOpenChange: (path: string) => void
  hasChange: boolean
}) {
  const title = stepTitle(step)

  // Agent narration ("Now updating the Home hero…") reads as prose, not a collapsible row.
  if (step.kind === 'thought' && step.detail && !step.durationMs) {
    const titleStem = step.title.replace(/…$/, '')
    if (step.detail.startsWith(titleStem)) {
      return (
        <p className='whitespace-pre-wrap py-1.5 text-sm leading-relaxed text-foreground/90'>
          {step.detail}
        </p>
      )
    }
  }

  if (step.kind === 'thought' || step.kind === 'terminal') {
    const isTerminal = step.kind === 'terminal'
    return (
      <details className='group' open={step.status === 'running' || (!isTerminal && Boolean(step.detail))}>
        <summary className='flex cursor-pointer list-none items-center gap-2 py-1 text-sm text-muted-foreground hover:text-foreground'>
          <StepIcon step={step} />
          <span className={cn('truncate', isTerminal && 'font-mono text-xs')}>
            {isTerminal ? `$ ${title.replace(/^\$\s*/, '')}` : title}
          </span>
          {step.detail ? (
            <ChevronRight className='h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-90' />
          ) : null}
        </summary>
        {step.detail ? (
          isTerminal ? (
            <pre className='ml-5 mt-1 max-h-60 overflow-auto rounded-md bg-zinc-950 px-3 py-2 font-mono text-[11px] leading-relaxed text-emerald-300'>
              {step.detail}
            </pre>
          ) : (
            <p className='ml-5 mt-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground/80'>
              {step.detail}
            </p>
          )
        ) : null}
      </details>
    )
  }

  if (step.kind === 'edit') {
    const clickable = Boolean(step.path && hasChange)
    return (
      <div className='py-1'>
        <button
          type='button'
          disabled={!clickable}
          onClick={() => step.path && onOpenChange(step.path)}
          className={cn(
            'flex w-full items-center gap-2 text-left text-sm',
            clickable ? 'text-foreground hover:underline' : 'cursor-default text-foreground'
          )}
          title={step.path}
        >
          <StepIcon step={step} />
          <span className='truncate font-medium'>{title}</span>
        </button>
        {step.detail ? (
          <p className='ml-5 mt-0.5 text-xs text-muted-foreground'>{step.detail}</p>
        ) : null}
      </div>
    )
  }

  if (step.kind === 'summary') {
    return (
      <div className='mt-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2'>
        <div className='flex items-center gap-2 text-sm font-medium text-foreground'>
          <StepIcon step={step} />
          <span className='truncate'>{title}</span>
        </div>
        {step.detail && step.detail !== title ? (
          <p className='mt-1 whitespace-pre-wrap text-xs leading-relaxed text-foreground/80'>
            {step.detail}
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <div className='py-1'>
      <div
        className={cn(
          'flex items-center gap-2 text-sm',
          step.kind === 'read' ? 'text-muted-foreground' : 'text-foreground/90'
        )}
        title={step.path}
      >
        <StepIcon step={step} />
        <span className='truncate'>{title}</span>
      </div>
      {step.detail ? (
        <p
          className={cn(
            'ml-5 mt-0.5 text-xs',
            step.status === 'failed' ? 'text-red-500' : 'text-muted-foreground'
          )}
        >
          {step.detail}
        </p>
      ) : null}
    </div>
  )
}

function ChangesTab({
  run,
  selectedPath,
  onSelect,
}: {
  run: AgentRun
  selectedPath: string | null
  onSelect: (path: string) => void
}) {
  const selected =
    run.changes.find((change) => change.path === selectedPath) || run.changes[0] || null

  if (run.changes.length === 0) {
    return (
      <p className='px-4 py-6 text-sm text-muted-foreground'>
        {run.status === 'running' ? 'No files changed yet.' : 'This run did not change any files.'}
      </p>
    )
  }

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <ul className='max-h-40 shrink-0 overflow-y-auto border-b border-border px-2 py-2'>
        {run.changes.map((change) => (
          <li key={change.path}>
            <button
              type='button'
              onClick={() => onSelect(change.path)}
              className={cn(
                'flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm',
                selected?.path === change.path
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
              )}
              title={change.path}
            >
              {change.isNew || change.original === null ? (
                <FilePlus2 className='h-3.5 w-3.5 shrink-0 text-emerald-500' />
              ) : (
                <FilePenLine className='h-3.5 w-3.5 shrink-0 text-sky-500' />
              )}
              <span className='truncate font-mono text-xs'>{change.path}</span>
            </button>
          </li>
        ))}
      </ul>
      {selected ? (
        <div className='min-h-0 flex-1 overflow-auto'>
          <FileDiffView
            key={selected.path}
            oldContent={selected.original ?? ''}
            newContent={selected.modified}
            filePath={selected.path}
            diffMode={DiffModeEnum.Unified}
          />
        </div>
      ) : null}
    </div>
  )
}

export function DetailsView() {
  const detailsPlanId = useMainViewStore((state) => state.detailsPlanId)
  const backToLatest = useMainViewStore((state) => state.backToLatest)
  const run = useAgentRunStore((state) => {
    const planId = detailsPlanId ?? state.order[state.order.length - 1]
    return planId ? state.runs[planId] : undefined
  })
  const [tab, setTab] = useState<DetailsTab>('timeline')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const elapsed = useElapsed(run)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stepCount = run?.steps.length ?? 0

  const changedPaths = useMemo(
    () => new Set(run?.changes.map((change) => change.path) ?? []),
    [run?.changes]
  )

  // Follow new rows while the run is live, like a log tail.
  useEffect(() => {
    if (tab !== 'timeline' || run?.status !== 'running') return
    const el = scrollRef.current
    if (el && stepCount > 0) {
      el.scrollTop = el.scrollHeight
    }
  }, [stepCount, run?.status, tab])

  const openChange = (path: string) => {
    setSelectedPath(path)
    setTab('changes')
  }

  return (
    <div className='flex h-full min-h-0 flex-col bg-background'>
      <div className='flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2.5'>
        <button
          type='button'
          onClick={backToLatest}
          className='flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-foreground hover:bg-muted'
        >
          <ArrowLeft className='h-4 w-4' />
          Back to latest
        </button>
        {run ? (
          <p className='truncate text-xs text-muted-foreground'>
            {formatElapsed(elapsed)} · {stepCount} step{stepCount === 1 ? '' : 's'}
          </p>
        ) : null}
      </div>

      {!run ? (
        <p className='px-4 py-6 text-sm text-muted-foreground'>
          Details for this message are no longer available. Run details are kept for the current
          session only.
        </p>
      ) : (
        <>
          <div className='flex shrink-0 items-center gap-1 border-b border-border px-4'>
            {(['timeline', 'changes'] as const).map((value) => (
              <button
                key={value}
                type='button'
                onClick={() => setTab(value)}
                className={cn(
                  '-mb-px border-b-2 px-3 py-2 text-sm capitalize',
                  tab === value
                    ? 'border-foreground font-medium text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                )}
              >
                {value}
                {value === 'changes' && run.changes.length > 0 ? (
                  <span className='ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px]'>
                    {run.changes.length}
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          {tab === 'timeline' ? (
            <div ref={scrollRef} className='min-h-0 flex-1 overflow-y-auto px-4 py-3'>
              <div className='mx-auto flex max-w-3xl flex-col'>
                {run.steps.map((step) => (
                  <TimelineRow
                    key={step.id}
                    step={step}
                    onOpenChange={openChange}
                    hasChange={Boolean(step.path && changedPaths.has(step.path))}
                  />
                ))}
                {run.status === 'running' ? (
                  <div className='flex items-center gap-2 py-2 text-sm text-muted-foreground'>
                    <Loader2 className='h-3.5 w-3.5 animate-spin' />
                    Working…
                  </div>
                ) : (
                  <p className='pt-3 text-xs text-muted-foreground'>{run.latestLabel}</p>
                )}
              </div>
            </div>
          ) : (
            <div className='min-h-0 flex-1'>
              <ChangesTab run={run} selectedPath={selectedPath} onSelect={setSelectedPath} />
            </div>
          )}
        </>
      )}
    </div>
  )
}
