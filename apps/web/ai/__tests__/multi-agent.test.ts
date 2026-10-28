import { describe, expect, it } from 'vitest'
import { parseCursorFilePatches } from '../agent/cursor-bridge'
import { planSwarmTasks, filterWritesForAgent } from '../agent/multi-agent'

describe('multi-agent swarm', () => {
  it('assigns OpenAI frontend and Cursor backend for full builds', () => {
    const tasks = planSwarmTasks('build TIFF Nepal travel website with auth', {
      cursorEnabled: true,
    })
    expect(tasks.some((task) => task.agent === 'openai-frontend')).toBe(true)
    expect(tasks.some((task) => task.agent === 'cursor-backend' && task.status === 'queued')).toBe(
      true
    )
  })

  it('marks Cursor tasks skipped when disabled', () => {
    const tasks = planSwarmTasks('fix signup database error', { cursorEnabled: false })
    const cursor = tasks.find((task) => task.agent === 'cursor-backend')
    expect(cursor?.status).toBe('skipped')
  })

  it('filters writes by agent ownership', () => {
    const writes = [
      { path: 'src/pages/Home.tsx', content: 'UI' },
      { path: 'server/auth.ts', content: 'API' },
    ]
    expect(filterWritesForAgent(writes, 'openai-frontend').map((w) => w.path)).toEqual([
      'src/pages/Home.tsx',
    ])
    expect(filterWritesForAgent(writes, 'cursor-backend').map((w) => w.path)).toEqual([
      'server/auth.ts',
    ])
  })
})

describe('parseCursorFilePatches', () => {
  it('parses fenced JSON file patches', () => {
    const text = `Here you go
\`\`\`json
{"report":"auth fix","files":[{"path":"server/auth.ts","content":"export const x=1","description":"fix"}]}
\`\`\`
`
    const writes = parseCursorFilePatches(text)
    expect(writes).toHaveLength(1)
    expect(writes[0]?.path).toBe('server/auth.ts')
    expect(writes[0]?.content).toContain('export const x=1')
  })
})
