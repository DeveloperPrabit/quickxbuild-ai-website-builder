import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_RUNS, labelForStep, useAgentRunStore } from './use-agent-run-store'

describe('useAgentRunStore', () => {
  beforeEach(() => {
    useAgentRunStore.getState().reset()
  })

  it('records one edit step per write, even for different files', () => {
    const store = useAgentRunStore.getState()
    store.startRun('p1')
    for (const path of ['src/App.tsx', 'src/pages/Index.tsx', 'src/index.css']) {
      store.pushStep('p1', { id: `edit-${path}`, kind: 'edit', title: `Edited ${path}`, path })
    }
    const run = useAgentRunStore.getState().runs.p1
    expect(run?.steps.filter((s) => s.kind === 'edit')).toHaveLength(3)
    expect(run?.latestLabel).toBe('Edited index.css')
  })

  it('keeps the path on read steps and updates a running step in place', () => {
    const store = useAgentRunStore.getState()
    store.startRun('p1')
    store.pushStep('p1', {
      id: 'read-1',
      kind: 'read',
      title: 'Read',
      path: 'src/pages/Services.tsx',
      status: 'running',
    })
    expect(useAgentRunStore.getState().runs.p1?.latestLabel).toBe('Reading Services.tsx')
    store.pushStep('p1', { id: 'read-1', kind: 'read', title: 'Read', status: 'done' })
    const step = useAgentRunStore.getState().runs.p1?.steps[0]
    expect(step?.path).toBe('src/pages/Services.tsx')
    expect(step?.status).toBe('done')
    expect(typeof step?.durationMs).toBe('number')
  })

  it('keeps the first original and the latest modified for a changed file', () => {
    const store = useAgentRunStore.getState()
    store.startRun('p1')
    store.upsertChange('p1', { path: 'a.ts', original: 'v0', modified: 'v1' })
    store.upsertChange('p1', { path: 'a.ts', original: 'v1', modified: 'v2' })
    const change = useAgentRunStore.getState().runs.p1?.changes[0]
    expect(change).toEqual({ path: 'a.ts', original: 'v0', modified: 'v2', isNew: undefined })
  })

  it('keeps runs per plan and trims the oldest', () => {
    const store = useAgentRunStore.getState()
    for (let i = 0; i < MAX_RUNS + 3; i++) {
      store.startRun(`p${i}`)
    }
    const state = useAgentRunStore.getState()
    expect(Object.keys(state.runs)).toHaveLength(MAX_RUNS)
    expect(state.runs.p0).toBeUndefined()
    expect(state.runs[`p${MAX_RUNS + 2}`]).toBeDefined()
  })

  it('summarizes edited files when the run finishes', () => {
    const store = useAgentRunStore.getState()
    store.startRun('p1')
    store.pushStep('p1', { id: 'w', kind: 'edit', title: 'x', path: 'a.ts', status: 'running' })
    store.upsertChange('p1', { path: 'a.ts', original: null, modified: 'x', isNew: true })
    store.finishRun('p1', 'done')
    const run = useAgentRunStore.getState().runs.p1
    expect(run?.status).toBe('done')
    expect(run?.steps[0]?.status).toBe('done')
    expect(run?.latestLabel).toMatch(/^Edited 1 file · \d+s$/)
  })

  it('labels terminal steps', () => {
    expect(labelForStep({ kind: 'terminal', title: 'bun install', status: 'running' })).toBe(
      'Running bun install'
    )
  })
})
