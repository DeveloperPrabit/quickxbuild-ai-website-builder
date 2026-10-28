/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * model-gateway-e2e.test.ts
 *
 * MODEL-001 acceptance: REAL Agent Runtime (runAgentLoop → tools → sandbox persist →
 * Phase 3 build/repair/preview → gate) driven by the REAL services/model-server process
 * (TestModelProvider + TestTeacherProvider, no network). The AI SDK provider path is
 * mocked to throw so any fallback fails the test.
 *
 * Skips when services/model-server/.venv is missing.
 */

import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const streamTextCalls: string[] = []

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()
  return {
    ...actual,
    streamText: vi.fn((opts: { prompt?: string }) => {
      streamTextCalls.push(String(opts.prompt || ''))
      throw new Error('provider path must not run when the model service answers')
    }),
  }
})

vi.mock('../agent/cursor-bridge', () => ({
  isCursorAgentEnabled: () => false,
  runCursorBackendAgent: async () => null,
}))

import { createInMemoryDurableHistory } from '../agent/in-memory-history'
import { runAgentLoop } from '../agent/loop'
import {
  isProjectMutationLockHeld,
  resetProjectMutationLocksForTests,
} from '../agent/project-mutation-lock'
import type { AgentEvent } from '../agent/runtime-events'
import type { AllowlistedCommandSpec } from '../agent/sandbox-commands'
import { createLocalSandboxFilesystem } from '../agent/sandbox-fs'

const SERVICE_DIR = path.resolve(__dirname, '../../../../services/model-server')
const PYTHON = [
  path.join(SERVICE_DIR, '.venv', 'Scripts', 'python.exe'),
  path.join(SERVICE_DIR, '.venv', 'bin', 'python'),
].find((candidate) => existsSync(candidate))

const HOTEL_PROMPT =
  'Build a hotel website using React with:\n- homepage\n- responsive navbar\n- hero section\n' +
  '- rooms section\n- room cards\n- booking CTA\n- contact section'
const HERO_SOURCE =
  'export default function Hero() {\n  return (\n    <section>\n' +
  '      <h1 className="text-5xl">Welcome to Our Hotel</h1>\n    </section>\n  )\n}\n'
const APP_SOURCE =
  "import Hero from './components/Hero'\n\nexport default function App() {\n  return (\n" +
  '    <main>\n      <Hero />\n    </main>\n  )\n}\n'
const IMPORT_RE = /^import\s+[^'"]*?from\s+['"]([^'"]+)['"]/gm

const ENV_KEYS = [
  'QUICKXBUILD_MODEL_SERVICE_ENABLED',
  'QUICKXBUILD_TEACHER_ENABLED',
  'QUICKXBUILD_TRAJECTORY_RECORDING_ENABLED',
  'MODEL_SERVICE_URL',
  'MODEL_SERVICE_TOKEN',
] as const

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

async function listFiles(root: string, dir = ''): Promise<string[]> {
  const entries = await readdir(path.join(root, dir), { withFileTypes: true })
  const out: string[] = []
  for (const entry of entries) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...(await listFiles(root, rel)))
    else out.push(rel)
  }
  return out.sort()
}

/** Deterministic stand-in for `vite build`: resolves relative imports and packages. */
async function resolveImports(root: string, packages: Set<string>): Promise<string | null> {
  const files = await listFiles(root)
  const present = new Set(files)
  for (const file of files) {
    if (!/\.(tsx?|jsx?)$/.test(file)) continue
    const content = await readFile(path.join(root, file), 'utf8')
    for (const match of content.matchAll(IMPORT_RE)) {
      const specifier = match[1] as string
      if (specifier.startsWith('.')) {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier))
        if (!['', '.tsx', '.ts'].some((ext) => present.has(`${target}${ext}`))) {
          return `Failed to resolve import "${specifier}" from "${file}". Does the file exist?`
        }
      } else {
        const name = specifier.startsWith('@')
          ? specifier.split('/').slice(0, 2).join('/')
          : (specifier.split('/')[0] as string)
        if (!packages.has(name)) return `Failed to resolve import "${specifier}" from "${file}".`
      }
    }
  }
  return null
}

describe.skipIf(!PYTHON)(
  'QuickXBuild model service E2E (real Agent Runtime + real model-server)',
  () => {
    let server: ChildProcess | undefined
    let baseUrl = ''
    let dataDir = ''
    let tempRoot = ''
    const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {}

    beforeAll(async () => {
      const port = await freePort()
      baseUrl = `http://127.0.0.1:${port}`
      dataDir = await mkdtemp(path.join(os.tmpdir(), 'qxb-model-data-'))
      server = spawn(
        PYTHON as string,
        [
          '-m',
          'uvicorn',
          'app.main:app_factory',
          '--factory',
          '--host',
          '127.0.0.1',
          '--port',
          String(port),
        ],
        {
          cwd: SERVICE_DIR,
          env: {
            NODE_ENV: 'test',
          PATH: process.env.PATH,
            SYSTEMROOT: process.env.SYSTEMROOT,
            SERVICE_ENV: 'test',
            MODEL_PROVIDER: 'test',
            TEACHER_ENABLED: 'true',
            TEACHER_PROVIDER: 'test',
            MODEL_DATA_DIR: dataDir,
            LOG_LEVEL: 'WARNING',
          },
          stdio: 'ignore',
        }
      )
      const deadline = Date.now() + 30_000
      while (Date.now() < deadline) {
        try {
          const health = await fetch(`${baseUrl}/health`)
          if (health.ok) break
        } catch {
          // not up yet
        }
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
      const health = await fetch(`${baseUrl}/health`)
      expect(health.ok).toBe(true)

      for (const key of ENV_KEYS) savedEnv[key] = process.env[key]
      process.env.QUICKXBUILD_MODEL_SERVICE_ENABLED = 'true'
      process.env.QUICKXBUILD_TEACHER_ENABLED = 'true'
      process.env.QUICKXBUILD_TRAJECTORY_RECORDING_ENABLED = 'true'
      process.env.MODEL_SERVICE_URL = baseUrl
      delete process.env.MODEL_SERVICE_TOKEN
    }, 60_000)

    afterAll(async () => {
      for (const key of ENV_KEYS) {
        if (savedEnv[key] === undefined) delete process.env[key]
        else process.env[key] = savedEnv[key]
      }
      server?.kill()
      if (dataDir) await rm(dataDir, { recursive: true, force: true })
    })

    beforeEach(async () => {
      resetProjectMutationLocksForTests()
      streamTextCalls.length = 0
      if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
      tempRoot = await mkdtemp(path.join(os.tmpdir(), 'qxb-e2e-'))
      await mkdir(path.join(tempRoot, 'src', 'components'), { recursive: true })
    })

    async function run(prompt: string, initialFiles: Record<string, string>, id: string) {
      for (const [file, content] of Object.entries(initialFiles)) {
        await writeFile(path.join(tempRoot, file), content, 'utf8')
      }
      const sandbox = createLocalSandboxFilesystem(tempRoot)
      const history = createInMemoryDurableHistory()
      const events: AgentEvent[] = []
      const packages = new Set(['react', 'react-dom'])
      const commands: string[] = []
      const projectId = `proj_${id}`

      const result = await runAgentLoop({
        prompt,
        xmlFiles: '',
        fileMap: Object.fromEntries(
          Object.entries(initialFiles).map(([file, content]) => [file, { content }])
        ),
        userPlan: 'enterprise',
        planId: `plan_${id}`,
        projectId,
        sandbox,
        appendDurableHistory: history.append,
        onAgentEvent: (event) => events.push(event),
        phase3RunCommand: async (_root, spec: AllowlistedCommandSpec) => {
          commands.push(`${spec.kind}:${spec.args.join(' ')}`)
          const base = { command: spec.bin, args: spec.args, cwd: tempRoot, durationMs: 1 }
          if (spec.kind === 'install') {
            if (spec.args[0] === 'add') for (const pkg of spec.args.slice(1)) packages.add(pkg)
            return { ...base, exitCode: 0, stdout: 'installed', stderr: '', ok: true }
          }
          const error = await resolveImports(tempRoot, packages)
          return error
            ? { ...base, exitCode: 1, stdout: '', stderr: `[vite]: ${error}`, ok: false }
            : { ...base, exitCode: 0, stdout: 'built', stderr: '', ok: true }
        },
        phase3CheckPreview: async () => ({ ok: true, url: 'http://127.0.0.1:5174/' }),
      })

      const trajectoryId = await result.trajectorySubmission
      expect(isProjectMutationLockHeld(projectId)).toBe(false)
      expect(streamTextCalls).toEqual([])
      return { result, events, history, packages, commands, sandbox, trajectoryId }
    }

    const types = (events: AgentEvent[]) => events.map((event) => event.type)
    const repairCount = (events: AgentEvent[]) =>
      events.filter(
        (e) => e.type === 'step_start' && (e as { data: { step: string } }).data.step === 'repair'
      ).length
    const teacherCount = (events: AgentEvent[]) =>
      events.filter(
        (e) => e.type === 'step_start' && (e as { data: { step: string } }).data.step === 'teacher'
      ).length

    async function getJson(urlPath: string) {
      const response = await fetch(`${baseUrl}${urlPath}`)
      expect(response.ok).toBe(true)
      return response.json() as Promise<Record<string, unknown>>
    }

    it('scenario 30: hotel website — build fails, model repair fails, teacher repairs, gate passes', async () => {
      const { result, events, packages, sandbox, trajectoryId } = await run(
        HOTEL_PROMPT,
        { 'src/main.tsx': "import App from './App'\n" },
        'hotel'
      )
      const t = types(events)

      expect(t[0]).toBe('agent_start')
      expect(t.filter((x) => x === 'build_error')).toHaveLength(2)
      expect(repairCount(events)).toBe(2)
      expect(teacherCount(events)).toBe(1)
      expect(t).toContain('build_success')
      expect(t).toContain('preview_status')
      expect(t.at(-1)).toBe('agent_done')
      expect(t.filter((x) => x === 'agent_start')).toHaveLength(1)
      expect(result.phase3Gate?.success).toBe(true)

      expect(await sandbox.readFile('src/components/booking-widget.tsx')).toBeTruthy()
      expect(await sandbox.readFile('src/components/BookingWidget.tsx')).toBeTruthy()
      expect(await sandbox.readFile('src/components/Navbar.tsx')).toBeTruthy()
      expect(packages.has('lucide-react')).toBe(true)

      expect(trajectoryId).toBeTruthy()
      const stored = await getJson(`/v1/trajectories/${trajectoryId}`)
      expect(stored.teacher_used).toBe(true)
      expect(stored.build_success).toBe(true)
      expect(stored.preview_success).toBe(true)
      expect(stored.training_eligible).toBe(false)
      const quality = stored.quality as { gate_success: boolean; penalties: { repairs: number } }
      expect(quality.gate_success).toBe(true)
      expect(quality.penalties.repairs).toBeCloseTo(0.1)
      const steps = stored.steps as Array<{ type: string; data: Record<string, unknown> }>
      const stepTypes = steps.map((s) => s.type)
      expect(stepTypes).toContain('model_decision')
      expect(stepTypes.indexOf('teacher_intervention')).toBeGreaterThan(
        stepTypes.indexOf('repair_attempt')
      )
      expect(steps.some((s) => s.type === 'tool_result' && s.data.source === 'teacher')).toBe(true)

      // Not eligible by default → dataset build refuses; after consent it builds.
      const blocked = await fetch(`${baseUrl}/v1/datasets/build`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataset_version: 'v1', trajectory_ids: [trajectoryId] }),
      })
      expect(blocked.status).toBe(422)
      const eligibility = await fetch(`${baseUrl}/v1/trajectories/${trajectoryId}/eligibility`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ training_eligible: true, reason: 'e2e consent' }),
      })
      expect(eligibility.ok).toBe(true)
      const dataset = await fetch(`${baseUrl}/v1/datasets/build`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataset_version: 'v1', trajectory_ids: [trajectoryId] }),
      })
      expect(dataset.status).toBe(201)
      const body = (await dataset.json()) as {
        examples: Array<{
          outcome: string
          teacher_guidance: string | null
          tool_actions: Array<{ source: string }>
          diagnostics: Array<{ source?: string }>
        }>
      }
      expect(body.examples).toHaveLength(1)
      const example = body.examples[0]
      expect(example?.outcome).toBe('success')
      expect(example?.teacher_guidance).toContain('BookingWidget')
      expect(example?.tool_actions.some((a) => a.source === 'teacher')).toBe(true)
      expect(example?.diagnostics[0]?.source).toBe('vite-transform')
    }, 60_000)

    it("scenario 31: 'Discover Nepal' heading change — no teacher", async () => {
      const { result, events, sandbox, trajectoryId } = await run(
        "Change the homepage hero heading to 'Discover Nepal'.",
        { 'src/App.tsx': APP_SOURCE, 'src/components/Hero.tsx': HERO_SOURCE },
        'nepal'
      )
      expect(teacherCount(events)).toBe(0)
      expect(repairCount(events)).toBe(0)
      expect(result.phase3Gate?.success).toBe(true)
      expect(await sandbox.readFile('src/components/Hero.tsx')).toContain('>Discover Nepal</h1>')
      expect(types(events)).toContain('file_patch')

      const stored = await getJson(`/v1/trajectories/${trajectoryId}`)
      expect(stored.teacher_used).toBe(false)
      expect(stored.build_success).toBe(true)
    }, 60_000)

    it('scenario 32: low confidence escalates to teacher before the build and completes', async () => {
      const { result, events, sandbox, trajectoryId } = await run(
        'Add a testimonials section to the homepage',
        { 'src/App.tsx': APP_SOURCE, 'src/components/Hero.tsx': HERO_SOURCE },
        'low'
      )
      const t = types(events)
      const teacherIndex = events.findIndex(
        (e) => e.type === 'step_start' && (e as { data: { step: string } }).data.step === 'teacher'
      )
      expect(teacherIndex).toBeGreaterThan(-1)
      expect(teacherIndex).toBeLessThan(t.indexOf('build_start'))
      expect(result.phase3Gate?.success).toBe(true)
      expect(await sandbox.readFile('src/App.tsx')).toContain('<TestimonialsSection />')

      const stored = await getJson(`/v1/trajectories/${trajectoryId}`)
      const steps = stored.steps as Array<{ type: string; data: Record<string, unknown> }>
      const decision = steps.find((s) => s.type === 'model_decision')
      expect(decision?.data.escalation_reason).toBe('low_confidence')
    }, 60_000)

    it('scenario 33: build fails twice, then teacher-guided repair succeeds', async () => {
      const before = await getJson('/v1/metrics')
      const { result, events } = await run(
        'Create a photography portfolio website with a hero and an image grid',
        {},
        'gallery'
      )
      const sequence = events
        .map((e) =>
          e.type === 'step_start' ? (e as { data: { step: string } }).data.step : e.type
        )
        .filter((x) => ['build_error', 'repair', 'teacher', 'build_success'].includes(x))
      expect(sequence).toEqual([
        'build_error',
        'repair',
        'build_error',
        'repair',
        'teacher',
        'build_success',
      ])
      expect(result.phase3Gate?.success).toBe(true)

      const after = await getJson('/v1/metrics')
      expect(Number(after.teacher_calls) - Number(before.teacher_calls)).toBe(1)
      const reasons = after.escalations_by_reason as Record<string, number>
      expect(reasons.repeated_build_failure).toBeGreaterThanOrEqual(2)
    }, 60_000)

    it('falls back to the provider path when the model service is unreachable', async () => {
      const saved = process.env.MODEL_SERVICE_URL
      process.env.MODEL_SERVICE_URL = 'http://127.0.0.1:1'
      process.env.QUICKXBUILD_TRAJECTORY_RECORDING_ENABLED = 'false'
      try {
        const events: AgentEvent[] = []
        const result = await runAgentLoop({
          prompt: "Change the homepage hero heading to 'Discover Nepal'.",
          xmlFiles: '',
          fileMap: { 'src/components/Hero.tsx': { content: HERO_SOURCE } },
          userPlan: 'enterprise',
          planId: 'plan_fallback',
          onAgentEvent: (event) => events.push(event),
        })
        // The (mocked, failing) provider path ran instead of the model service.
        expect(streamTextCalls.length).toBeGreaterThan(0)
        expect(result.trajectorySubmission).toBeUndefined()
        expect(types(events).filter((x) => x === 'agent_start')).toHaveLength(1)
      } finally {
        process.env.MODEL_SERVICE_URL = saved
        process.env.QUICKXBUILD_TRAJECTORY_RECORDING_ENABLED = 'true'
        streamTextCalls.length = 0
      }
    }, 60_000)
  }
)
