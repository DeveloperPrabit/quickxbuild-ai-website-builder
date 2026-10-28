/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * data-proxy-token.ts
 * Copyright (C) 2025 Nextify Limited
 *
 * HMAC-signed project tokens for the secure data proxy.
 * Generated apps never receive Postgres connection strings.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

const TOKEN_PREFIX = 'quickxbuild_dt_'

export type DataProxyClaims = {
  projectId: string
  tenantId: string
  /** Unix seconds expiry; 0 = non-expiring project credential. */
  exp: number
}

function getSecret(): string {
  const secret =
    process.env.DATA_PROXY_SECRET ||
    process.env.BETTER_AUTH_SECRET ||
    process.env.AUTH_SECRET
  if (!secret || secret.length < 16) {
    throw new Error('DATA_PROXY_SECRET (or BETTER_AUTH_SECRET) is required for data proxy tokens')
  }
  return secret
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64url')
}

function signPayload(payloadB64: string): string {
  return createHmac('sha256', getSecret()).update(payloadB64).digest('base64url')
}

/** Mint a long-lived project data-proxy token. */
export function issueDataProxyToken(
  projectId: string,
  tenantId: string,
  options?: { expiresInSeconds?: number }
): string {
  const exp =
    options?.expiresInSeconds && options.expiresInSeconds > 0
      ? Math.floor(Date.now() / 1000) + options.expiresInSeconds
      : 0
  const payloadB64 = b64url(JSON.stringify({ projectId, tenantId, exp } satisfies DataProxyClaims))
  const sig = signPayload(payloadB64)
  return `${TOKEN_PREFIX}${payloadB64}.${sig}`
}

/** Validate Bearer token; returns claims or null. */
export function verifyDataProxyToken(token: string | null | undefined): DataProxyClaims | null {
  if (!token) return null
  const raw = token.startsWith('Bearer ') ? token.slice(7).trim() : token.trim()
  if (!raw.startsWith(TOKEN_PREFIX)) return null

  const body = raw.slice(TOKEN_PREFIX.length)
  const dot = body.lastIndexOf('.')
  if (dot <= 0) return null

  const payloadB64 = body.slice(0, dot)
  const sig = body.slice(dot + 1)
  const expected = signPayload(payloadB64)

  try {
    const a = Buffer.from(sig)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return null
    }
  } catch {
    return null
  }

  try {
    const claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as DataProxyClaims
    if (!claims?.projectId || !claims?.tenantId) return null
    if (claims.exp > 0 && claims.exp < Math.floor(Date.now() / 1000)) return null
    return claims
  } catch {
    return null
  }
}
