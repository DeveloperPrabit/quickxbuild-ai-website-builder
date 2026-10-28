/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * accept-writes.ts — Accept Cursor/XML/compat writes via Phase 2 persist pipeline
 *
 * Phase 4: XML is an adapter into this function — never a second writer.
 *
 * Any mutation that becomes part of Agent Runtime `writes` / allWrites when a
 * persistMutation adapter is present MUST go through:
 *   lock → sandbox → durable history → file_write/file_patch
 *
 * Without persistMutation (unit tests / legacy), writes stay RAM-only and must
 * never be treated as sandbox-persisted Phase 2 events by production callers.
 */

import type { PersistMutationFn } from './tools'
import type { AgentWrite } from './xml'

export type AcceptWritesTimeline = (step: {
  kind: 'edit'
  title: string
  path: string
  detail?: string
  status: 'done' | 'failed'
}) => void

/**
 * Accept a batch of file mutations into the Agent Runtime write set.
 * When `persistMutation` is provided, each write is persisted authoritatively;
 * only successful persists are returned (and thus may appear in allWrites).
 */
export async function acceptRuntimeWrites(input: {
  writes: AgentWrite[]
  fileMap: Record<string, { content?: string }>
  persistMutation?: PersistMutationFn
  /** Default write_file; Cursor/XML full-file replacements use write_file. */
  operation?: 'write_file' | 'apply_patch'
  source: 'cursor' | 'xml' | 'guaranteed'
  onTimeline?: AcceptWritesTimeline
}): Promise<AgentWrite[]> {
  const accepted: AgentWrite[] = []
  const operation = input.operation || 'write_file'

  for (const write of input.writes) {
    const norm = write.path.replace(/^\.\//, '')
    const original =
      input.fileMap[norm]?.content ??
      input.fileMap[write.path]?.content ??
      input.fileMap[`./${norm}`]?.content ??
      null

    if (!input.persistMutation) {
      // Compatibility / tests without Phase 2 adapter — RAM only, no file_write claim.
      input.fileMap[norm] = { content: write.content }
      input.fileMap[write.path] = { content: write.content }
      accepted.push({ ...write, path: norm })
      input.onTimeline?.({
        kind: 'edit',
        title: `Edited ${norm.split('/').pop() || norm}`,
        path: norm,
        detail: write.description,
        status: 'done',
      })
      continue
    }

    const result = await input.persistMutation({
      operation,
      path: norm,
      content: write.content,
      description: write.description || `${input.source} write ${norm}`,
      originalContent: original,
    })

    if (!result.ok) {
      console.warn(
        `[AgentRuntime] ${input.source} write not accepted (persist failed): ${norm}: ${result.error}`
      )
      input.onTimeline?.({
        kind: 'edit',
        title: `Failed ${norm.split('/').pop() || norm}`,
        path: norm,
        detail: result.error,
        status: 'failed',
      })
      continue
    }

    input.fileMap[result.path] = { content: write.content }
    input.fileMap[norm] = { content: write.content }
    accepted.push({ ...write, path: result.path })
    input.onTimeline?.({
      kind: 'edit',
      title: `Edited ${result.path.split('/').pop() || result.path}`,
      path: result.path,
      detail: write.description,
      status: 'done',
    })
  }

  return accepted
}
