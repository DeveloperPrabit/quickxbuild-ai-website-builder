/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * project-mutation-lock.ts — Per-project server-side mutation mutex (Phase 2)
 *
 * Serializes write_file / apply_patch → sandbox → history → runtime event
 * for a single projectId within this Node/Bun process.
 *
 * Limitation: process-local only. Multi-process / multi-replica deployments
 * do not share this lock; a distributed lock would be required for that topology.
 */

type QueueTail = Promise<unknown>

const projectQueues = new Map<string, QueueTail>()

/**
 * Run `fn` while holding the exclusive mutation lock for `projectId`.
 * Concurrent callers for the same project wait in FIFO order.
 * Different projectIds do not block each other.
 * Lock is always released when `fn` settles (success or failure).
 */
export async function withProjectMutationLock<T>(
  projectId: string,
  fn: () => Promise<T>
): Promise<T> {
  if (!projectId) {
    throw new Error('withProjectMutationLock requires a non-empty projectId')
  }

  const previous = projectQueues.get(projectId) ?? Promise.resolve()

  let release!: () => void
  const hold = new Promise<void>((resolve) => {
    release = resolve
  })

  // Next waiter awaits this chain; `hold` stays pending until we finish.
  const chained: QueueTail = previous.then(() => hold)
  projectQueues.set(projectId, chained)

  await previous.catch(() => undefined)

  try {
    return await fn()
  } finally {
    release()
    if (projectQueues.get(projectId) === chained) {
      projectQueues.delete(projectId)
    }
  }
}

/** Test helper: whether any waiter is queued/holding for this project. */
export function isProjectMutationLockHeld(projectId: string): boolean {
  return projectQueues.has(projectId)
}

/** Test helper: clear all locks (only for isolated unit tests). */
export function resetProjectMutationLocksForTests(): void {
  projectQueues.clear()
}
