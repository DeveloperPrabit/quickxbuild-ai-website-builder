/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * use-terminal-store.ts — Append-only Agent Runtime terminal log
 */

import { create } from 'zustand'

export type TerminalLineKind = 'command' | 'stdout' | 'stderr' | 'info'

export type TerminalLine = {
  id: string
  ts: number
  kind: TerminalLineKind
  text: string
  /** Why the command ran (build_plan step label). */
  why?: string
}

type TerminalState = {
  lines: TerminalLine[]
  append: (line: Omit<TerminalLine, 'id' | 'ts'> & { id?: string; ts?: number }) => void
  reset: () => void
}

let seq = 0

export const useTerminalStore = create<TerminalState>((set) => ({
  lines: [],
  append: (line) => {
    const text = (line.text || '').trimEnd()
    if (!text && line.kind !== 'command') {
      return
    }
    set((state) => {
      const next: TerminalLine = {
        id: line.id || `term-${Date.now()}-${++seq}`,
        ts: line.ts || Date.now(),
        kind: line.kind,
        text: text || line.text || '',
        why: line.why,
      }
      return { lines: [...state.lines.slice(-200), next] }
    })
  },
  reset: () => set({ lines: [] }),
}))
