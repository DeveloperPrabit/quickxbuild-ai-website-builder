/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * run-status-line.tsx — One-line live run label in chat that opens the main-pane Details view
 */

'use client'

import { cn } from '@quickxbuild/ui/lib/utils'
import { CheckCircle2, ChevronRight, Loader2, XCircle } from 'lucide-react'
import { useAgentRunStore } from '@/components/ide/quickxbuild/hooks/use-agent-run-store'
import { useMainViewStore } from '@/components/ide/quickxbuild/hooks/use-main-view-store'

export function RunStatusLine({ planId }: { planId: string }) {
  const run = useAgentRunStore((state) => state.runs[planId])
  const openDetails = useMainViewStore((state) => state.openDetails)
  const isOpen = useMainViewStore(
    (state) => state.view === 'details' && state.detailsPlanId === planId
  )

  if (!run || (run.steps.length === 0 && run.status !== 'running')) {
    return null
  }

  const running = run.status === 'running'

  return (
    <button
      type='button'
      onClick={() => openDetails(planId)}
      className={cn(
        'group mb-2 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
        isOpen ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
      )}
      aria-label='Open run details'
    >
      {running ? (
        <Loader2 className='h-3.5 w-3.5 shrink-0 animate-spin text-amber-500' />
      ) : run.status === 'failed' ? (
        <XCircle className='h-3.5 w-3.5 shrink-0 text-red-500' />
      ) : (
        <CheckCircle2 className='h-3.5 w-3.5 shrink-0 text-emerald-500' />
      )}
      <span className='min-w-0 flex-1 truncate'>
        {run.latestLabel}
      </span>
      <ChevronRight className='h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5' />
    </button>
  )
}
