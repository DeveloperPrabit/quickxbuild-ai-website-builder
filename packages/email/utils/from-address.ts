/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * from-address.ts — Resend From header with QuickXBuild display name
 */

import { env } from '../env.mjs'

const DISPLAY_NAME = 'QuickXBuild'

/**
 * Format RESEND_FROM for Resend. Bare emails become `QuickXBuild <email@domain>`.
 * Values that already include a display name are left unchanged (except QuickXBuild → QuickXBuild).
 */
export function getResendFromAddress(from = env.RESEND_FROM): string {
  const trimmed = from.trim()
  const named = trimmed.match(/^(.+?)\s*<([^>]+)>$/)
  if (named?.[1] && named[2]) {
    const name = named[1].replace(/^["']|["']$/g, '').replace(/QuickXBuild( AI)?/gi, DISPLAY_NAME).trim()
    return `${name} <${named[2].trim()}>`
  }
  return `${DISPLAY_NAME} <${trimmed}>`
}
