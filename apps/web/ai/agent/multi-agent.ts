/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * multi-agent.ts — OpenAI (frontend) + Cursor (backend) task split
 *
 * Clear ownership to reduce hallucination:
 * - OpenAI agent: UI only (src/pages, src/components, App shell styling/routes)
 * - Cursor agent: backend only (server/*, schema, auth, db, package.json deps)
 * - Planner: assigns work; agents must not steal each other's files
 */

export type SwarmAgent = 'planner' | 'openai-frontend' | 'cursor-backend' | 'cursor-debug'

export type SwarmTaskStatus = 'queued' | 'running' | 'done' | 'failed' | 'blocked' | 'skipped'

export type SwarmTask = {
  id: string
  title: string
  agent: SwarmAgent
  status: SwarmTaskStatus
  files: string[]
  reason?: string
  prompt: string
}

const FRONTEND_HINT =
  /\b(ui|page|pages|button|form|dashboard|admin|shop|screen|layout|header|footer|nav|navbar|hero|css|tailwind|component|design|frontend|landing|destination|package|tour|image|style)\b/i

const BACKEND_HINT =
  /\b(api|schema|server|route|endpoint|auth|database|db|neon|postgres|migrate|signup|login|session|socket|install|dependency|package\.json|backend|webhook|ledger|mail)\b/i

const DEBUG_HINT =
  /\b(fix|bug|error|preview|debug|blank|crash|failed|resolve import|econnrefused|request failed)\b/i

/** Paths Cursor owns — OpenAI must not rewrite these. */
export const CURSOR_PATH_PREFIXES = [
  'server/',
  'scripts/',
  'drizzle/',
  'package.json',
  '.dev.vars',
  'bun.lock',
  'bun.lockb',
]

/** Paths OpenAI owns — Cursor must not rewrite these. */
export const OPENAI_PATH_PREFIXES = [
  'src/pages/',
  'src/components/',
  'src/hooks/',
  'src/lib/',
  'src/assets/',
  'src/index.css',
  'src/App.tsx',
  'src/main.tsx',
  'index.html',
]

export function isCursorPath(path: string): boolean {
  const clean = path.replace(/^\.\//, '')
  return CURSOR_PATH_PREFIXES.some(
    (prefix) => clean === prefix || clean.startsWith(prefix)
  )
}

export function isOpenAIPath(path: string): boolean {
  const clean = path.replace(/^\.\//, '')
  if (isCursorPath(clean)) {
    return false
  }
  return OPENAI_PATH_PREFIXES.some(
    (prefix) => clean === prefix || clean.startsWith(prefix)
  )
}

export function filterWritesForAgent<T extends { path: string }>(
  writes: T[],
  agent: 'openai-frontend' | 'cursor-backend' | 'cursor-debug'
): T[] {
  if (agent === 'openai-frontend') {
    return writes.filter((write) => isOpenAIPath(write.path) || write.path.includes('src/'))
  }
  return writes.filter((write) => isCursorPath(write.path) || !isOpenAIPath(write.path))
}

/**
 * Split one user request into parallel agent tasks.
 * When Cursor is disabled, backend/debug tasks are marked skipped (OpenAI covers them).
 */
export function planSwarmTasks(
  prompt: string,
  options: { cursorEnabled: boolean } = { cursorEnabled: false }
): SwarmTask[] {
  const wantsFrontend = FRONTEND_HINT.test(prompt) || !BACKEND_HINT.test(prompt)
  const wantsBackend = BACKEND_HINT.test(prompt)
  const wantsDebug = DEBUG_HINT.test(prompt)
  const isFullBuild =
    /\b(website|web ?app|build|create|generate|travel|saas|landing)\b/i.test(prompt)

  const tasks: SwarmTask[] = [
    {
      id: 'plan',
      title: 'Assign OpenAI (UI) and Cursor (backend) work',
      agent: 'planner',
      status: 'running',
      files: [],
      prompt:
        'You are the planner only. Do not write files. Assign UI to OpenAI and server/auth/db to Cursor.',
    },
  ]

  if (wantsFrontend || isFullBuild) {
    tasks.push({
      id: 'openai-ui',
      title: 'OpenAI: frontend pages, nav, images, App.tsx routes',
      agent: 'openai-frontend',
      status: 'queued',
      files: [],
      prompt: [
        'ROLE: OpenAI frontend agent ONLY.',
        'ALLOWED: src/pages/*, src/components/*, src/App.tsx, src/assets/*, CSS.',
        'FORBIDDEN: server/*, database schema, auth API, package.json dependencies, Neon config.',
        'If you need backend work, stop and leave a short note — Cursor owns backend.',
        'Do not invent API contracts that contradict existing server routes; call existing endpoints.',
        '',
        `USER REQUEST:\n${prompt}`,
      ].join('\n'),
    })
  }

  if (wantsBackend || wantsDebug || isFullBuild) {
    const cursorOn = options.cursorEnabled
    tasks.push({
      id: 'cursor-api',
      title: cursorOn
        ? 'Cursor: server, auth, DB, deps, preview import fixes'
        : 'Backend (Cursor offline — OpenAI will cover)',
      agent: 'cursor-backend',
      status: cursorOn ? 'queued' : 'skipped',
      files: [],
      reason: cursorOn ? undefined : 'CURSOR_API_KEY not configured',
      prompt: [
        'ROLE: Cursor backend agent ONLY.',
        'ALLOWED: server/*, schema, migrate, auth, package.json, bun install, socket/realtime.',
        'FORBIDDEN: redesigning marketing pages or inventing new UI layouts (OpenAI owns UI).',
        'Fix Vite "Failed to resolve import" by installing missing packages.',
        'Use Neon DATABASE_URL / APP_SCHEMA from env — never hardcode localhost Postgres.',
        'After fixes, list changed file paths clearly.',
        '',
        `USER REQUEST:\n${prompt}`,
      ].join('\n'),
    })
  }

  if (wantsDebug) {
    const cursorOn = options.cursorEnabled
    tasks.push({
      id: 'cursor-debug',
      title: cursorOn
        ? 'Cursor: diagnose bugs and report fix plan to OpenAI UI agent'
        : 'Debug (Cursor offline)',
      agent: 'cursor-debug',
      status: cursorOn ? 'queued' : 'skipped',
      files: [],
      reason: cursorOn ? undefined : 'CURSOR_API_KEY not configured',
      prompt: [
        'ROLE: Cursor debugger.',
        'Find root cause (stack, missing dep, auth, DB).',
        'If the bug is backend — fix files under server/* yourself.',
        'If the bug is UI-only — write a short BUG_REPORT for OpenAI (do not rewrite pages).',
        'Format BUG_REPORT as: path, symptom, exact fix needed.',
        '',
        `USER REQUEST:\n${prompt}`,
      ].join('\n'),
    })
  }

  if (tasks.length === 1) {
    tasks.push({
      id: 'openai-ui',
      title: 'OpenAI: implement requested UI change',
      agent: 'openai-frontend',
      status: 'queued',
      files: [],
      prompt: `ROLE: OpenAI frontend agent.\n\nUSER REQUEST:\n${prompt}`,
    })
  }

  return tasks
}

export function openaiSystemForSwarm(): string {
  return `You are the OpenAI FRONTEND agent in a multi-agent QuickXBuild swarm.
You ONLY edit UI files under src/ (pages, components, App.tsx, assets, CSS).
Cursor owns server/, auth, DB, and package installs — do not rewrite those.
Never claim you deployed or fixed Neon yourself.
Call write_file / apply_patch with complete file contents for UI changes.
Use real Unsplash/Pexels URLs for travel photos when needed.`
}

export function markSwarmAfterApply(
  tasks: SwarmTask[],
  appliedBy: Partial<Record<SwarmAgent, string[]>>,
  applied: boolean
): SwarmTask[] {
  return tasks.map((task) => {
    if (task.agent === 'planner') {
      return { ...task, status: 'done' as const }
    }
    if (task.status === 'skipped') {
      return task
    }
    const files = appliedBy[task.agent] || []
    if (files.length > 0) {
      return { ...task, status: 'done' as const, files }
    }
    if (!applied && (task.agent === 'openai-frontend' || task.agent === 'cursor-backend')) {
      return {
        ...task,
        status: 'failed' as const,
        reason: task.reason || 'No file actions were applied',
      }
    }
    return { ...task, status: task.status === 'running' ? 'done' : task.status }
  })
}
