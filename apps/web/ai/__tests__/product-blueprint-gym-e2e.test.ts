/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * product-blueprint-gym-e2e.test.ts — TheProBuilder gym full-build acceptance
 *
 * Proves blueprint → completeness → ordered passes → Phase 3 mock gate
 * without calling live LLM providers.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildOrchestratedPasses, isDependencyOnlyBuild } from '../agent/build-passes'
import { resolveAllowlistedCommand } from '../agent/sandbox-commands'
import { createLocalSandboxFilesystem } from '../agent/sandbox-fs'
import {
  analyzeProductBlueprint,
  blueprintToCompleteness,
  buildPlanFromBlueprint,
  buildSiteResearch,
} from '../design/product-blueprint'

const GYM_PROMPT = 'make a website for gym named: theprobuilder'

type StreamPart = Record<string, unknown>
type ToolMap = Record<string, { execute?: (input: unknown, opts: unknown) => Promise<unknown> }>

function createHoldOpenStream() {
  const queue: StreamPart[] = []
  let closed = false
  let wake: (() => void) | null = null
  const signal = () => {
    wake?.()
    wake = null
  }
  return {
    push(part: StreamPart) {
      if (closed) return
      queue.push(part)
      signal()
    },
    close() {
      closed = true
      signal()
    },
    async *[Symbol.asyncIterator]() {
      while (true) {
        while (queue.length === 0 && !closed) {
          await new Promise<void>((resolve) => {
            wake = resolve
          })
        }
        if (queue.length === 0 && closed) return
        yield queue.shift() as StreamPart
      }
    },
  }
}

const INDEX_PAGE = `export default function Index() {
  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <h1>TheProBuilder</h1>
      <p>Train harder. Live stronger.</p>
    </main>
  )
}
`

const APP_SHELL = `import { BrowserRouter, Route, Routes } from "react-router-dom"
import Index from "./pages/Index"
import About from "./pages/About"
import Classes from "./pages/Classes"
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/about" element={<About />} />
        <Route path="/classes" element={<Classes />} />
      </Routes>
    </BrowserRouter>
  )
}
`

const CSS = `:root { --background: #0B0B0C; --foreground: #F5F5F5; --accent: #E8FF47; }
body { background: var(--background); color: var(--foreground); }`

const HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>TheProBuilder | Gym</title>
    <meta name="description" content="TheProBuilder gym website" />
  </head>
  <body><div id="root"></div></body>
</html>`

const ABOUT = `export default function About(){ return <main><h1>About TheProBuilder</h1></main> }`
const CLASSES = `export default function Classes(){ return <main><h1>Classes</h1></main> }`

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()
  return {
    ...actual,
    streamText: vi.fn((opts: { prompt: string; tools: ToolMap; system?: string }) => {
      const tools = (opts.tools || {}) as ToolMap
      const prompt = String(opts.prompt || '')
      const stream = createHoldOpenStream()
      const isRepair = prompt.includes('BUILD FAILED') || prompt.includes('<diagnostic>')

      void (async () => {
        try {
          if (isRepair) {
            stream.push({ type: 'finish' })
            stream.close()
            return
          }
          const writes: Array<{ path: string; content: string }> = [
            { path: 'src/pages/Index.tsx', content: INDEX_PAGE },
            { path: 'src/pages/About.tsx', content: ABOUT },
            { path: 'src/pages/Classes.tsx', content: CLASSES },
            { path: 'src/App.tsx', content: APP_SHELL },
            { path: 'src/index.css', content: CSS },
            { path: 'index.html', content: HTML },
          ]
          let i = 0
          for (const write of writes) {
            if (!tools.write_file?.execute) break
            const id = `w${++i}`
            stream.push({ type: 'tool-input-start', id, toolName: 'write_file' })
            stream.push({
              type: 'tool-call',
              toolCallId: id,
              toolName: 'write_file',
              input: {
                path: write.path,
                content: write.content,
                description: `Write ${write.path}`,
              },
            })
            const out = await tools.write_file.execute(
              {
                path: write.path,
                content: write.content,
                description: `Write ${write.path}`,
              },
              { toolCallId: id, messages: [] }
            )
            stream.push({
              type: 'tool-result',
              toolCallId: id,
              toolName: 'write_file',
              input: { path: write.path },
              output: out,
            })
          }
        } finally {
          stream.push({ type: 'finish' })
          stream.close()
        }
      })()

      return {
        fullStream: stream,
        text: Promise.resolve('Built TheProBuilder gym site.'),
        steps: Promise.resolve([]),
        toolCalls: Promise.resolve([]),
      }
    }),
  }
})

vi.mock('../agent/cursor-bridge', () => ({
  isCursorAgentEnabled: () => false,
  runCursorBackendAgent: async () => null,
}))

vi.mock('../providers', () => ({
  GEMINI_FALLBACK_MODEL_ID: 'chat-model-gemini-flash',
  GEMINI_FALLBACK_MODEL_NAME: 'gemini-2.5-flash',
  myProvider: {
    languageModel: () => ({ modelId: 'mock' }),
  },
}))

vi.mock('../models', () => ({
  buildProviderOptions: () => ({}),
}))

vi.mock('../capabilities', () => ({
  selectCapabilities: () => ({
    fast: 'mock-fast',
    code: 'mock-code',
    vision: 'mock-vision',
  }),
}))

import { runAgentLoop } from '../agent/loop'
import { resetProjectMutationLocksForTests } from '../agent/project-mutation-lock'

describe('TheProBuilder gym E2E (mocked Agent Runtime)', () => {
  let tmp: string

  beforeEach(async () => {
    resetProjectMutationLocksForTests()
    tmp = await mkdtemp(path.join(os.tmpdir(), 'quickxbuild-gym-e2e-'))
    await mkdir(path.join(tmp, 'src', 'pages'), { recursive: true })
    await writeFile(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: 'app', scripts: { build: 'echo ok' } })
    )
    await writeFile(path.join(tmp, 'src', 'App.tsx'), 'export default function App(){return null}')
    await writeFile(
      path.join(tmp, 'src', 'pages', 'Index.tsx'),
      'export default function Index(){return <div>QuickXBuild Ecommerce</div>}'
    )
    await writeFile(path.join(tmp, 'src', 'index.css'), 'body{}')
    await writeFile(path.join(tmp, 'index.html'), '<html><title>Starter</title></html>')
  })

  afterEach(async () => {
    resetProjectMutationLocksForTests()
    await rm(tmp, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  it('analyzes blueprint with brand pages SEO and research', () => {
    const bp = analyzeProductBlueprint(GYM_PROMPT)!
    expect(bp.brandName.toLowerCase()).toContain('theprobuilder')
    expect(bp.vertical).toBe('gym')
    expect(bp.pages.length).toBeGreaterThanOrEqual(3)
    expect(bp.pages.some((p) => p.path === '/classes')).toBe(true)
    expect(bp.seo.titleTemplate.toLowerCase()).toContain('theprobuilder')

    const research = buildSiteResearch(GYM_PROMPT, bp)
    expect(research.audience.toLowerCase()).toContain('fitness')
    expect(research.sectionIdeas.length).toBeGreaterThan(2)

    const completeness = blueprintToCompleteness(bp)
    expect(completeness.some((c) => c.path === 'src/App.tsx')).toBe(true)
    expect(completeness.some((c) => c.path === 'index.html')).toBe(true)
    expect(completeness.some((c) => c.path === 'src/index.css')).toBe(true)
    expect(completeness.filter((c) => c.path.startsWith('/')).length).toBeGreaterThanOrEqual(3)

    const plan = buildPlanFromBlueprint(bp)
    expect(plan.some((i) => i.id === 'backend')).toBe(true)
    expect(plan.some((i) => i.id === 'design')).toBe(true)
    expect(plan.some((i) => i.id === 'verify')).toBe(true)
  })

  it('orders backend before design assets shell and pages', () => {
    const bp = analyzeProductBlueprint(GYM_PROMPT)!
    const passes = buildOrchestratedPasses(bp)
    const ids = passes.map((p) => p.id)
    expect(ids.indexOf('backend')).toBeLessThan(ids.indexOf('design'))
    expect(ids.indexOf('design')).toBeLessThan(ids.indexOf('assets'))
    expect(ids.indexOf('assets')).toBeLessThan(ids.indexOf('shell'))
    expect(ids.indexOf('shell')).toBeLessThan(ids.indexOf('pages'))
    expect(ids.indexOf('pages')).toBeLessThan(ids.indexOf('seo'))
  })

  it('rejects CRA-style arbitrary shell and allows verify_dev', () => {
    expect(() => resolveAllowlistedCommand('npx create-react-app')).toThrow(/not allowlisted/)
    const verify = resolveAllowlistedCommand('verify_dev')
    expect(verify.kind).toBe('verify_dev')
    expect(verify.args).toEqual(['run', 'build'])
  })

  it('flags dependency-only builds for forced UI', () => {
    expect(isDependencyOnlyBuild(['package.json', 'bun.lock'])).toBe(true)
    expect(isDependencyOnlyBuild(['src/pages/Index.tsx', 'src/App.tsx'])).toBe(false)
  })

  it('runs agent loop writing Index App CSS HTML and ≥3 pages with Phase 3 success', async () => {
    const bp = analyzeProductBlueprint(GYM_PROMPT)!
    const completeness = blueprintToCompleteness(bp)
    const sandbox = createLocalSandboxFilesystem(tmp)
    const fileMap: Record<string, { content?: string }> = {
      'src/App.tsx': { content: await sandbox.readFile('src/App.tsx') || '' },
      'src/pages/Index.tsx': { content: await sandbox.readFile('src/pages/Index.tsx') || '' },
      'src/index.css': { content: await sandbox.readFile('src/index.css') || '' },
      'index.html': { content: await sandbox.readFile('index.html') || '' },
      'package.json': { content: await sandbox.readFile('package.json') || '' },
    }

    const result = await runAgentLoop({
      prompt: GYM_PROMPT,
      xmlFiles: '',
      fileMap,
      userPlan: 'pro',
      completeness,
      blueprint: bp,
      planId: 'gym-e2e',
      projectId: 'gym-project',
      sandbox,
      appendDurableHistory: async () => {},
      phase3RunCommand: async (_root, spec) => ({
        command: spec.bin,
        args: spec.args,
        cwd: tmp,
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
        durationMs: 1,
        ok: true,
      }),
      phase3CheckPreview: async () => ({ ok: true }),
      phase3PreviewUrl: 'https://example.e2b.app',
    })

    const paths = result.writes.map((w) => w.path.replace(/^\.\//, ''))
    expect(paths.some((p) => p.endsWith('Index.tsx'))).toBe(true)
    expect(paths.some((p) => p.endsWith('index.css') || p.includes('App.tsx'))).toBe(true)
    expect(paths.some((p) => p === 'index.html' || p.endsWith('index.html'))).toBe(true)
    const pageWrites = paths.filter((p) => /pages\/.+\.tsx$/i.test(p))
    expect(pageWrites.length).toBeGreaterThanOrEqual(3)
    expect(result.applied).toBe(true)
    // Phase 3 must have run (install/build/preview) for mutation success
    expect(result.phase3Gate).toBeDefined()
    expect(result.phase3Gate?.success).toBe(true)

    const indexHtml = await sandbox.readFile('index.html')
    expect(indexHtml?.toLowerCase()).toContain('theprobuilder')
  }, 60_000)
})
