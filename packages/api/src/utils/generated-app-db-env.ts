/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * generated-app-db-env.ts
 * Copyright (C) 2025 Nextify Limited
 *
 * Env injected into AI-built app sandboxes / local preview APIs.
 * Apps use Neon Postgres with per-project APP_SCHEMA — never localhost defaults.
 */

import { issueDataProxyToken } from '@quickxbuild/db'

/** Sanitize project id into a Postgres schema name `app_*`. */
export function schemaForProject(projectId: string): string {
  const raw = `app_${projectId}`
  const safe = raw.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 63)
  if (!safe.startsWith('app_') || safe.length < 5) {
    return `app_${Date.now()}`
  }
  return safe
}

/**
 * Build env for a generated app runtime.
 * Prefers platform Neon (`POSTGRES_URL`) + schema isolation.
 * Also mints a data-proxy token for optional document APIs.
 */
export function buildGeneratedAppDbEnv(
  projectId: string,
  tenantId: string
): Record<string, string> {
  const neonUrl = (process.env.POSTGRES_URL || process.env.DATABASE_URL || '').trim()
  const appOrigin = (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.QUICKXBUILD_DATA_API_ORIGIN ||
    'http://localhost:3000'
  ).replace(/\/$/, '')

  const env: Record<string, string> = {
    APP_SCHEMA: schemaForProject(projectId),
    APP_API_PORT: process.env.APP_API_PORT || '8787',
  }

  // Let Vite inside the sandbox allow framing from the builder UI.
  if (appOrigin) {
    env.NEXT_PUBLIC_APP_URL = appOrigin
    env.PREVIEW_FRAME_ANCESTORS = [
      appOrigin,
      (process.env.PREVIEW_FRAME_ANCESTORS || '').trim(),
    ]
      .filter(Boolean)
      .join(' ')
  }

  if (neonUrl) {
    // Per-project schema on shared Neon — login/signup/migrate use this.
    env.DATABASE_URL = neonUrl
  }

  try {
    env.QUICKXBUILD_DATA_API_URL = `${appOrigin}/api/data`
    env.QUICKXBUILD_DATA_API_TOKEN = issueDataProxyToken(projectId, tenantId)
  } catch {
    // Token optional when secret missing; Neon schema path still works.
  }

  return env
}

export function formatEnvFile(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value.replace(/\n/g, '')}`)
    .join('\n')
}
