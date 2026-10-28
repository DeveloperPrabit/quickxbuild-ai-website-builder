/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * agent-board.tsx
 * Copyright (C) 2025 Nextify Limited
 */

'use client'

import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react'
import { type BuildPlanItem, useAgentBoardStore } from './hooks/use-agent-board-store'

function PlanStatusIcon({ status }: { status: BuildPlanItem['status'] }) {
  if (status === 'running') {
    return <Loader2 className='h-3 w-3 animate-spin text-amber-500' />
  }
  if (status === 'done') {
    return <CheckCircle2 className='h-3 w-3 text-emerald-500' />
  }
  if (status === 'failed') {
    return <XCircle className='h-3 w-3 text-red-500' />
  }
  return <Circle className='h-3 w-3 text-muted-foreground/60' />
}

/** Build plan checklist for the chat column; the full run timeline lives in DetailsView. */
export function AgentBoard() {
  const buildPlan = useAgentBoardStore((state) => state.buildPlan)

  if (!buildPlan) {
    return null
  }

  const doneCount = buildPlan.items.filter((item) => item.status === 'done').length

  return (
    <div className='max-h-[30vh] shrink-0 overflow-y-auto border-b border-border bg-background/90 px-3 py-2'>
      <div className='mx-auto max-w-4xl rounded-md border border-sky-500/30 bg-sky-500/5 px-2.5 py-2'>
        <div className='flex items-center justify-between gap-2'>
          <p className='text-xs font-semibold text-foreground'>
            Build plan
            {buildPlan.brandName ? ` · ${buildPlan.brandName}` : ''}
            {buildPlan.vertical ? (
              <span className='ml-1 font-normal text-muted-foreground'>
                ({buildPlan.vertical})
              </span>
            ) : null}
          </p>
          <p className='text-[11px] text-muted-foreground'>
            {doneCount}/{buildPlan.items.length}
          </p>
        </div>
        <ul className='mt-1.5 space-y-1'>
          {buildPlan.items.map((item) => (
            <li key={item.id} className='flex items-start gap-1.5 text-[11px]'>
              <span className='mt-0.5 shrink-0'>
                <PlanStatusIcon status={item.status} />
              </span>
              <span
                className={
                  item.status === 'done'
                    ? 'text-muted-foreground line-through'
                    : 'text-foreground/90'
                }
              >
                {item.label}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
