/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * persist-mutation.ts — Authoritative Phase 2 mutation pipeline
 *
 * Invariant (must hold under the project mutation lock):
 *   sandbox filesystem write
 *   → durable history append
 *   → file_write / file_patch runtime event
 *
 * Never claim persistedToSandbox unless the filesystem write succeeded.
 */

import type { DiffMessageType, FileDiffType } from '@quickxbuild/common'
import { withProjectMutationLock } from './project-mutation-lock'
import type { SandboxFilesystem } from './sandbox-fs'

export type MutationOperation = 'write_file' | 'apply_patch'

export type DurableMutationRecord = DiffMessageType & {
  /** Project this mutation belongs to (for audit; not part of HistoryType schema). */
  projectId?: string
  /** ISO timestamp when the sandbox write succeeded. */
  timestamp?: string
  /** Tool that produced this mutation. */
  operation?: MutationOperation
  /** Always true for records created after a successful sandbox write. */
  success?: true
  /** Marks history rows written by Agent Runtime (dedupe vs client deploy). */
  persistedByAgentRuntime?: true
}

export type PersistMutationInput = {
  projectId: string
  planId: string
  operation: MutationOperation
  path: string
  content: string
  description: string
  originalContent?: string | null
  sandbox: SandboxFilesystem
  /** Append durable history AFTER sandbox write succeeds. Must throw on failure. */
  appendDurableHistory: (record: DurableMutationRecord) => Promise<void>
  /** Emit authoritative file_write / file_patch AFTER history append. */
  emitFileEvent: (info: {
    operation: MutationOperation
    path: string
    bytes: number
    description: string
  }) => void
  /**
   * When true, caller already holds withProjectMutationLock for this project
   * (Phase 3 pipeline). Avoids deadlock from nested lock acquisition.
   */
  alreadyLocked?: boolean
}

export type PersistMutationSuccess = {
  ok: true
  persistedToSandbox: true
  path: string
  bytes: number
}

export type PersistMutationFailure = {
  ok: false
  persistedToSandbox: false
  path: string
  error: string
}

export type PersistMutationResult = PersistMutationSuccess | PersistMutationFailure

function buildFileDiff(
  filePath: string,
  content: string,
  original: string | null
): FileDiffType {
  const basename = filePath.split('/').pop() || filePath
  const dirname = filePath.split('/').slice(0, -1).join('/')
  const isNew = original == null || original === ''
  return {
    type: isNew ? 'create' : 'edit',
    path: filePath,
    basename,
    dirname,
    original,
    modified: content,
    additions: content.split('\n').length,
    deletions: original ? Math.max(0, original.split('\n').length - content.split('\n').length) : 0,
  }
}

/**
 * Execute one authoritative Agent Runtime file mutation under the project lock.
 */
export async function persistAgentMutation(
  input: PersistMutationInput
): Promise<PersistMutationResult> {
  const resolvedPath = input.path.replace(/\\/g, '/').replace(/^\.\//, '')

  const run = async (): Promise<PersistMutationResult> => {
    // 1) Sandbox filesystem write (runtime source of truth)
    await input.sandbox.writeFile(resolvedPath, input.content)

    const bytes = Buffer.byteLength(input.content, 'utf8')
    const original =
      input.originalContent === undefined ? null : input.originalContent

    const record: DurableMutationRecord = {
      type: 'diff',
      planId: input.planId,
      contentType: 'files',
      projectId: input.projectId,
      timestamp: new Date().toISOString(),
      operation: input.operation,
      success: true,
      persistedByAgentRuntime: true,
      diff: [buildFileDiff(resolvedPath, input.content, original)],
    }

    // 2) Durable history / apply log
    await input.appendDurableHistory(record)

    // 3) Authoritative runtime event (only after sandbox + history)
    input.emitFileEvent({
      operation: input.operation,
      path: resolvedPath,
      bytes,
      description: input.description,
    })

    return {
      ok: true as const,
      persistedToSandbox: true as const,
      path: resolvedPath,
      bytes,
    }
  }

  try {
    if (input.alreadyLocked) {
      return await run()
    }
    return await withProjectMutationLock(input.projectId, run)
  } catch (error) {
    return {
      ok: false,
      persistedToSandbox: false,
      path: resolvedPath,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
