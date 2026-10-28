/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * terminal-panel.tsx — Dedicated Agent Runtime terminal (read-only streamed log)
 */

'use client'

import { Copy, Terminal } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { type TerminalLine, useTerminalStore } from './hooks/use-terminal-store'

function lineClass(kind: TerminalLine['kind']): string {
  if (kind === 'command') return 'text-emerald-300'
  if (kind === 'stderr') return 'text-red-400'
  if (kind === 'info') return 'text-sky-300'
  return 'text-zinc-300'
}

export function TerminalPanel({ compact = false }: { compact?: boolean }) {
  const lines = useTerminalStore((state) => state.lines)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [lines.length])

  if (lines.length === 0) {
    return null
  }

  const copyAll = async () => {
    const text = lines
      .map((line) => {
        if (line.kind === 'command') {
          return line.why ? `# ${line.why}\n$ ${line.text}` : `$ ${line.text}`
        }
        return line.text
      })
      .join('\n')
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Terminal output copied')
    } catch {
      toast.error('Could not copy terminal output')
    }
  }

  return (
    <div
      className={
        compact
          ? 'max-h-[22vh] shrink-0 overflow-hidden border-b border-border bg-zinc-950'
          : 'flex h-full min-h-0 flex-col overflow-hidden bg-zinc-950'
      }
    >
      <div className='flex items-center justify-between gap-2 border-b border-zinc-800 px-3 py-1.5'>
        <div className='flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-zinc-400'>
          <Terminal className='h-3.5 w-3.5' />
          Terminal
        </div>
        <button
          type='button'
          onClick={copyAll}
          className='inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
        >
          <Copy className='h-3 w-3' />
          Copy
        </button>
      </div>
      <div className='min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed'>
        {lines.map((line) => (
          <div key={line.id} className={lineClass(line.kind)}>
            {line.kind === 'command' && line.why ? (
              <p className='mb-0.5 text-[10px] text-zinc-500'># {line.why}</p>
            ) : null}
            <pre className='whitespace-pre-wrap break-all'>
              {line.kind === 'command' ? `$ ${line.text}` : line.text}
            </pre>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
