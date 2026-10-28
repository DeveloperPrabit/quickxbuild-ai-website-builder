/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * cursor-bridge.ts — Cursor Cloud Agents HTTP API for backend swarm work
 *
 * Uses https://api.cursor.com/v1 (no @cursor/sdk — Next webpack cannot bundle it).
 * Cursor owns backend tokens; OpenAI owns frontend — see multi-agent.ts.
 */

import type { AgentWrite } from './xml'
import { isCursorPath } from './multi-agent'

const CURSOR_API = 'https://api.cursor.com/v1'

export function isCursorAgentEnabled(): boolean {
  const key = (process.env.CURSOR_API_KEY || '').trim()
  if (!key) return false
  if (process.env.CURSOR_AGENT_ENABLED === '0') return false
  return true
}

function cursorApiKey(): string {
  return (process.env.CURSOR_API_KEY || '').trim()
}

function cursorModelId(): string {
  return (process.env.CURSOR_AGENT_MODEL || 'composer-2.5').trim() || 'composer-2.5'
}

export type CursorBridgeResult = {
  ok: boolean
  writes: AgentWrite[]
  report: string
  error?: string
  agentId?: string
  runId?: string
}

function authHeaders(apiKey: string): HeadersInit {
  // Cloud Agents API accepts Basic (key:) or Bearer
  const basic = Buffer.from(`${apiKey}:`).toString('base64')
  return {
    Authorization: `Basic ${basic}`,
    'Content-Type': 'application/json',
  }
}

function summarizeBackendFiles(
  fileMap: Record<string, { content?: string }>
): string {
  const rows: string[] = []
  for (const [raw, entry] of Object.entries(fileMap)) {
    const path = raw.replace(/^\.\//, '')
    if (!isCursorPath(path) && !path.startsWith('server/')) continue
    const content = entry?.content ?? ''
    if (!content) continue
    rows.push(`### FILE: ${path}\n\`\`\`\n${content.slice(0, 6000)}\n\`\`\``)
    if (rows.length >= 12) break
  }
  return rows.join('\n\n')
}

/**
 * Parse Cursor assistant text for JSON file patches.
 * Accepts fenced ```json blocks or raw { "files": [...] }.
 */
export function parseCursorFilePatches(text: string): AgentWrite[] {
  if (!text) return []
  const writes: AgentWrite[] = []

  const tryParse = (raw: string) => {
    try {
      const parsed = JSON.parse(raw) as {
        files?: Array<{ path?: string; content?: string; description?: string }>
        report?: string
      }
      for (const file of parsed.files || []) {
        if (!file?.path || typeof file.content !== 'string') continue
        if (file.content.trim().length < 2) continue
        writes.push({
          path: file.path.replace(/^\.\//, ''),
          content: file.content,
          description: file.description || `Cursor update ${file.path}`,
        })
      }
      return parsed.report || ''
    } catch {
      return ''
    }
  }

  const fence = /```(?:json)?\s*([\s\S]*?)```/gi
  let match: RegExpExecArray | null = fence.exec(text)
  while (match) {
    tryParse(match[1] || '')
    match = fence.exec(text)
  }

  if (writes.length === 0) {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start >= 0 && end > start) {
      tryParse(text.slice(start, end + 1))
    }
  }

  return writes.filter((write) => isCursorPath(write.path) || write.path.startsWith('server/'))
}

async function sleep(ms: number, signal?: AbortSignal) {
  if (signal?.aborted) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true }
    )
  })
}

async function pollRun(
  apiKey: string,
  agentId: string,
  runId: string,
  signal?: AbortSignal
): Promise<{ status: string; result?: string; error?: string }> {
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    if (signal?.aborted) {
      return { status: 'CANCELLED', error: 'Aborted' }
    }
    const res = await fetch(`${CURSOR_API}/agents/${agentId}/runs/${runId}`, {
      headers: authHeaders(apiKey),
      signal,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { status: 'ERROR', error: `poll ${res.status}: ${body.slice(0, 200)}` }
    }
    const data = (await res.json()) as {
      status?: string
      result?: string
      error?: unknown
    }
    const status = (data.status || '').toUpperCase()
    if (status === 'FINISHED' || status === 'ERROR' || status === 'CANCELLED' || status === 'EXPIRED') {
      return {
        status,
        result: data.result,
        error: data.error ? String(data.error) : undefined,
      }
    }
    await sleep(2500, signal)
  }
  return { status: 'ERROR', error: 'Cursor run timed out' }
}

/**
 * Run Cursor cloud agent for backend/debug work and return file patches.
 */
export async function runCursorBackendAgent(input: {
  prompt: string
  fileMap: Record<string, { content?: string }>
  abortSignal?: AbortSignal
  onProgress?: (message: string) => void
}): Promise<CursorBridgeResult> {
  if (!isCursorAgentEnabled()) {
    return { ok: false, writes: [], report: '', error: 'Cursor agent disabled (no CURSOR_API_KEY)' }
  }

  const apiKey = cursorApiKey()
  const modelId = cursorModelId()
  const fileContext = summarizeBackendFiles(input.fileMap)

  const instruction = [
    input.prompt,
    '',
    'You are the Cursor BACKEND agent in QuickXBuild.',
    'OpenAI owns frontend (src/pages, components). You own server/, auth, DB, package.json.',
    'Return a single JSON object (optionally in a ```json fence) with this shape:',
    '{ "report": "short summary", "files": [ { "path": "server/foo.ts", "content": "FULL FILE", "description": "..." } ] }',
    'Only include files you changed. Full file contents required. No prose outside JSON.',
    '',
    'CURRENT BACKEND FILES:',
    fileContext || '(no server files in map — create server routes as needed)',
  ].join('\n')

  try {
    input.onProgress?.(`Starting Cursor cloud agent (${modelId})…`)

    const createRes = await fetch(`${CURSOR_API}/agents`, {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({
        prompt: { text: instruction },
        model: { id: modelId },
        name: 'QuickXBuild backend',
        // No-repo cloud agent — returns text patches we apply into the sandbox fileMap.
      }),
      signal: input.abortSignal,
    })

    if (!createRes.ok) {
      const body = await createRes.text().catch(() => '')
      return {
        ok: false,
        writes: [],
        report: '',
        error: `Cursor create failed ${createRes.status}: ${body.slice(0, 300)}`,
      }
    }

    const created = (await createRes.json()) as {
      agent?: { id?: string; latestRunId?: string }
      run?: { id?: string; agentId?: string; status?: string }
    }
    const agentId = created.agent?.id || created.run?.agentId
    const runId = created.run?.id || created.agent?.latestRunId
    if (!agentId || !runId) {
      return { ok: false, writes: [], report: '', error: 'Cursor create response missing agent/run id' }
    }

    input.onProgress?.('Cursor backend agent running…')
    const finished = await pollRun(apiKey, agentId, runId, input.abortSignal)
    const report = finished.result || finished.error || ''
    const writes = parseCursorFilePatches(report)

    input.onProgress?.(
      writes.length > 0
        ? `Cursor returned ${writes.length} backend file(s)`
        : 'Cursor finished (no parseable file patches)'
    )

    return {
      ok: finished.status === 'FINISHED' || writes.length > 0,
      writes,
      report: report.slice(0, 8000),
      agentId,
      runId,
      error: finished.status === 'ERROR' ? finished.error || report.slice(0, 300) : undefined,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('Cursor backend agent failed:', message)
    input.onProgress?.(`Cursor agent unavailable: ${message.slice(0, 120)}`)
    return { ok: false, writes: [], report: '', error: message }
  }
}
