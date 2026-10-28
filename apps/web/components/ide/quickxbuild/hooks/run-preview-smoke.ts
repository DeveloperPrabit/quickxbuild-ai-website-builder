/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * run-preview-smoke.ts
 * Copyright (C) 2025 Nextify Limited
 *
 * Network/preview errors must fail closed (ok: false).
 * failClosedSmoke capability stays false until Phase 6 completes the full preview-origin harness.
 *
 * LOCAL_* endpoints are for the Node/agent test harness only — never call this from the
 * browser while failClosedSmoke is false (user machines have nothing on :8787).
 */

import { AGENT_RUNTIME_CAPABILITIES } from '@/ai/agent/runtime-capabilities'

const LOCAL_HEALTH = 'http://127.0.0.1:8787/api/health'
const LOCAL_PRODUCTS = 'http://127.0.0.1:8787/api/products'

export type PreviewSmokeResult = { ok: boolean; reason?: string; skipped?: boolean }

/**
 * Map a thrown fetch/network error to a fail-closed smoke result.
 * Never convert network failure into ok: true.
 */
export function previewSmokeNetworkFailure(error: unknown): PreviewSmokeResult {
  const message = error instanceof Error ? error.message : 'network error'
  return { ok: false, reason: `Smoke failed: ${message}` }
}

export async function runPreviewSmokeChecks(
  fetchImpl: typeof fetch = fetch
): Promise<PreviewSmokeResult> {
  // Browser + Phase 6 off: skip harness so the IDE does not toast "Failed to fetch".
  if (typeof window !== 'undefined' && !AGENT_RUNTIME_CAPABILITIES.failClosedSmoke) {
    return { ok: true, skipped: true }
  }

  try {
    const health = await fetchImpl(LOCAL_HEALTH)
    if (!health.ok) {
      return { ok: false, reason: `Smoke failed: GET /api/health returned ${health.status}` }
    }
    const products = await fetchImpl(LOCAL_PRODUCTS)
    if (!products.ok) {
      return { ok: false, reason: `Smoke failed: GET /api/products returned ${products.status}` }
    }
    return { ok: true }
  } catch (error) {
    return previewSmokeNetworkFailure(error)
  }
}
