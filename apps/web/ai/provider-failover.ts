/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * provider-failover.ts — Prefer Meta Muse when configured. Legacy path: OpenAI first, then
 * Gemini only if Muse is unavailable. Refusal is remembered briefly so retries skip a dead provider.
 */

import { env } from '@/env.mjs'
import type { ProviderErrorInfo } from './agent/provider-errors'
import {
  GEMINI_FALLBACK_MODEL_ID,
  GEMINI_FALLBACK_MODEL_NAME,
  isMuseConfigured,
  MUSE_MODEL_ID,
  MUSE_MODEL_NAME,
  myProvider,
} from './providers'

const OPENAI_MODEL_IDS = new Set([
  'chat-model-reasoning-openai-astra',
  'chat-model-reasoning-openai',
  'chat-model-reasoning-openai-mini',
])

/** How long to skip OpenAI after it refused the account. */
export const OPENAI_REFUSAL_TTL_MS = 10 * 60 * 1000

let openaiRefusedUntil = 0

export function isGeminiFallbackConfigured(): boolean {
  return Boolean(env.GEMINI_API_KEY) && !isMuseConfigured()
}

export function isOpenAIModelId(modelId: string): boolean {
  return OPENAI_MODEL_IDS.has(modelId)
}

export function isOpenAIRefused(now = Date.now()): boolean {
  return openaiRefusedUntil > now
}

export function markOpenAIRefused(now = Date.now()): void {
  openaiRefusedUntil = now + OPENAI_REFUSAL_TTL_MS
}

/** Test hook. */
export function resetProviderFailover(): void {
  openaiRefusedUntil = 0
}

/** Model id actually used for a requested id (Muse primary; else Gemini while OpenAI is refused). */
export function resolveModelId(modelId: string): string {
  if (isMuseConfigured() && (isOpenAIModelId(modelId) || modelId === GEMINI_FALLBACK_MODEL_ID)) {
    return MUSE_MODEL_ID
  }
  if (isOpenAIModelId(modelId) && isOpenAIRefused() && isGeminiFallbackConfigured()) {
    return GEMINI_FALLBACK_MODEL_ID
  }
  return modelId
}

/** Gemini quotas reset per minute, so its 429s need backoff long enough (2+4+8+16+32s) to clear. */
export function maxRetriesFor(usedModelId: string): number {
  return usedModelId === GEMINI_FALLBACK_MODEL_ID ? 5 : 2
}

export function languageModelFor(modelId: string) {
  return myProvider.languageModel(resolveModelId(modelId))
}

/**
 * When the model that actually ran (`usedModelId`, after resolveModelId) was OpenAI and it hit
 * a fatal account error, mark OpenAI as refused and return true so the caller retries — the
 * retry resolves to Muse (if configured) or Gemini. Fatal Muse errors do not fail over to Gemini.
 */
export function failOverFromOpenAI(usedModelId: string, info: ProviderErrorInfo): boolean {
  if (!info.fatal || !isOpenAIModelId(usedModelId)) {
    return false
  }
  if (isMuseConfigured()) {
    markOpenAIRefused()
    console.warn(
      `[AI] OpenAI refused (${info.code ?? info.message}); routing to ${MUSE_MODEL_NAME}`
    )
    return true
  }
  if (!isGeminiFallbackConfigured()) {
    return false
  }
  markOpenAIRefused()
  console.warn(
    `[AI] OpenAI refused (${info.code ?? info.message}); falling back to ${GEMINI_FALLBACK_MODEL_NAME} for ${OPENAI_REFUSAL_TTL_MS / 60000} min`
  )
  return true
}

export function failoverNotice(info: ProviderErrorInfo): string {
  const reason =
    info.code === 'insufficient_quota' || info.code === 'credit_balance_exhausted'
      ? 'OpenAI is out of credits'
      : 'OpenAI rejected the request'
  if (isMuseConfigured()) {
    return `${reason} — continuing with ${MUSE_MODEL_NAME}.`
  }
  return `${reason} — continuing with ${GEMINI_FALLBACK_MODEL_NAME}.`
}
