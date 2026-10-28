/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * run-preview-smoke.test.ts — fail-closed network regression (Phase 0 tracking)
 *
 * failClosedSmoke capability remains false until Phase 6 completes the full harness.
 * This test locks the network-failure → ok:false contract so the old catch→ok:true cannot return.
 */

import { describe, expect, it, vi } from 'vitest'
import {
  previewSmokeNetworkFailure,
  runPreviewSmokeChecks,
} from '../hooks/run-preview-smoke'
import { AGENT_RUNTIME_CAPABILITIES } from '@/ai/agent/runtime-capabilities'

describe('runPreviewSmokeChecks fail-closed network behavior', () => {
  it('maps network errors to ok:false (never ok:true)', () => {
    const result = previewSmokeNetworkFailure(new Error('fetch failed'))
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/Smoke failed/i)
    expect(result.reason).toMatch(/fetch failed/i)
  })

  it('returns ok:false when fetch throws', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    const result = await runPreviewSmokeChecks(fetchImpl as unknown as typeof fetch)
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/ECONNREFUSED|Smoke failed/)
  })

  it('returns ok:false when health endpoint is non-OK', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503 })
    const result = await runPreviewSmokeChecks(fetchImpl as unknown as typeof fetch)
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/503/)
  })

  it('does not flip failClosedSmoke capability until Phase 6 harness is complete', () => {
    expect(AGENT_RUNTIME_CAPABILITIES.failClosedSmoke).toBe(false)
  })

  it('skips localhost harness in the browser while failClosedSmoke is false', async () => {
    const g = globalThis as typeof globalThis & { window?: unknown }
    const previous = g.window
    g.window = {}
    try {
      const fetchImpl = vi.fn().mockRejectedValue(new Error('Failed to fetch'))
      const result = await runPreviewSmokeChecks(fetchImpl as unknown as typeof fetch)
      expect(result.ok).toBe(true)
      expect(result.skipped).toBe(true)
      expect(fetchImpl).not.toHaveBeenCalled()
    } finally {
      if (previous === undefined) {
        delete g.window
      } else {
        g.window = previous
      }
    }
  })
})
