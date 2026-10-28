/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * preview-fixes.ts — Guaranteed writes when the model returns zero files
 */

import type { AgentWrite } from './xml'

const SOCKET_STUB = `/**
 * Realtime is optional. This stub NEVER imports socket.io-client so Vite Preview
 * always boots even when node_modules is incomplete (common on resumed sandboxes).
 */
export type AppSocket = {
  auth?: { userId?: string }
  disconnect: () => void
  connect: () => void
}

export function getAppSocket(_userId?: string): AppSocket | undefined {
  return undefined
}

export async function ensureAppSocket(_userId?: string): Promise<AppSocket | undefined> {
  return undefined
}
`

function needsSocketFix(
  fileMap: Record<string, { content?: string }>,
  prompt: string
): boolean {
  if (/\bsocket\.io-client\b|Failed to resolve import|vite:import-analysis/i.test(prompt)) {
    return true
  }
  for (const [path, file] of Object.entries(fileMap)) {
    if (!path.replace(/^\.\//, '').endsWith('src/lib/socket.ts')) continue
    const content = file.content || ''
    if (/from ['"]socket\.io-client['"]/.test(content)) return true
    if (/import\s*\(\s*['"]socket\.io-client['"]\s*\)/.test(content)) return true
    if (/typeof import\(['"]socket\.io-client['"]\)/.test(content)) return true
  }
  return false
}

/**
 * When the LLM returns no writes, still apply Preview-critical fixes so the IDE
 * never gets stuck on "plan without file changes" for known blockers.
 */
export function getGuaranteedPreviewWrites(
  fileMap: Record<string, { content?: string }>,
  prompt: string
): AgentWrite[] {
  const writes: AgentWrite[] = []
  // Always ship the stub when Preview is broken OR the tree still has a hard import.
  if (
    needsSocketFix(fileMap, prompt) ||
    /\bfix this\b|\bfix the\b|preview.*(error|fail)|import-analysis/i.test(prompt)
  ) {
    writes.push({
      path: 'src/lib/socket.ts',
      content: SOCKET_STUB,
      description: 'Neutralize socket.io-client so Vite Preview boots',
    })
  }
  return writes
}
