/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * xml-adapter.ts — Phase 4: XML is a compatibility adapter, NOT a second writer
 *
 * Allowed:
 *   XML text → AgentWrite[] → acceptRuntimeWrites → persistMutation → sandbox
 *
 * Forbidden:
 *   XML → direct sandbox write
 *   XML → direct deploy
 *   XML → second history append outside persistMutation
 *   emitting file_write/file_patch without persist success
 */

import { type AcceptWritesTimeline, acceptRuntimeWrites } from './accept-writes'
import { extractWritesFromXml } from './apply'
import type { PersistMutationFn } from './tools'
import type { AgentWrite } from './xml'

/**
 * Parse legacy plan XML into the SAME AgentWrite[] shape used by Agent Runtime tools.
 * Does not touch disk, history, preview, or emit runtime events.
 */
export function parseXmlCompatibilityWrites(text: string): AgentWrite[] {
  return extractWritesFromXml(text).map((write) => ({
    path: write.path.replace(/^\.\//, ''),
    content: write.content,
    description: write.description,
  }))
}

/**
 * Accept XML-derived writes through the single authoritative mutation pipeline.
 * Without `persistMutation`, writes are RAM-only (tests/compat) and must never be
 * treated as sandbox-persisted mutations by production callers.
 */
export async function acceptXmlCompatibilityWrites(input: {
  writes: AgentWrite[]
  fileMap: Record<string, { content?: string }>
  persistMutation?: PersistMutationFn
  onTimeline?: AcceptWritesTimeline
}): Promise<AgentWrite[]> {
  return acceptRuntimeWrites({
    writes: input.writes,
    fileMap: input.fileMap,
    persistMutation: input.persistMutation,
    operation: 'write_file',
    source: 'xml',
    onTimeline: input.onTimeline,
  })
}
