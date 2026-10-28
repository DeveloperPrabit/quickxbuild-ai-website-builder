/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * preview-health.ts — Fail-closed preview health for Agent Runtime (Phase 3)
 *
 * Network/unavailable/Vite-overlay → ok: false. Never invent success.
 * failClosedSmoke capability flag stays false until Phase 6 full harness.
 */

import { previewSmokeNetworkFailure } from '@/components/ide/quickxbuild/hooks/run-preview-smoke'

export type PreviewHealthResult = {
  ok: boolean
  url?: string
  reason?: string
}

/**
 * Check that a preview origin responds with a valid HTML document
 * and does not present a Vite error overlay.
 */
export async function checkPreviewHealth(input: {
  previewUrl?: string
  fetchImpl?: typeof fetch
}): Promise<PreviewHealthResult> {
  const fetchImpl = input.fetchImpl || fetch
  const base =
    input.previewUrl ||
    process.env.LOCAL_PREVIEW_URL ||
    process.env.AGENT_PREVIEW_URL ||
    ''

  if (!base) {
    return { ok: false, reason: 'Preview URL not configured' }
  }

  let url: string
  try {
    url = new URL(base).toString()
  } catch {
    return { ok: false, reason: `Invalid preview URL: ${base}` }
  }

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'text/html,*/*' },
      redirect: 'follow',
    })

    if (!response.ok) {
      return {
        ok: false,
        url,
        reason: `Preview returned HTTP ${response.status}`,
      }
    }

    const contentType = response.headers.get('content-type') || ''
    const body = await response.text()

    if (!/text\/html/i.test(contentType) && !/<html|<body|<div/i.test(body)) {
      return {
        ok: false,
        url,
        reason: 'Preview response is not a valid HTML document',
      }
    }

    if (
      /vite-error-overlay/i.test(body) ||
      /<vite-error-overlay/i.test(body)
    ) {
      return {
        ok: false,
        url,
        reason: 'Vite error overlay detected in preview document',
      }
    }

    if (/plugin:vite/i.test(body) && /Internal server error|Failed to resolve/i.test(body)) {
      return {
        ok: false,
        url,
        reason: 'Vite transform error present in preview',
      }
    }

    return { ok: true, url }
  } catch (error) {
    const failed = previewSmokeNetworkFailure(error)
    return { ok: false, url, reason: failed.reason }
  }
}
