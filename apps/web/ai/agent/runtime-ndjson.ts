/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * runtime-ndjson.ts — NDJSON encoding for Agent Runtime /api/ai stream (Phase 1)
 *
 * Response Content-Type must be application/x-ndjson (newline-delimited JSON).
 */

import type { AgentEvent } from './runtime-events'

/** MIME type for the Agent Runtime event stream. */
export const AI_RUNTIME_NDJSON_CONTENT_TYPE = 'application/x-ndjson'

/** Encode one Agent Runtime / progress object as a single NDJSON line. */
export function encodeAgentEventNdjsonLine(event: unknown): string {
  return `${JSON.stringify(event)}\n`
}

/**
 * Forward validated Agent Runtime events into an NDJSON byte stream
 * (same path used by /api/ai while tools are still executing).
 */
export function createNdjsonAgentEventForwarder(
  enqueue: (bytes: Uint8Array) => void
): (event: AgentEvent) => void {
  const encoder = new TextEncoder()
  return (event) => {
    enqueue(encoder.encode(encodeAgentEventNdjsonLine(event)))
  }
}
