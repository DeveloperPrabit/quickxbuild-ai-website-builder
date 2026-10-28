/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * provider-errors.ts — Classify model provider failures so account problems stop the run
 * immediately with a readable message instead of silently producing zero writes.
 */

export type ProviderErrorInfo = {
  /** True when retrying with the same provider account cannot succeed (billing, auth). */
  fatal: boolean
  code?: string
  message: string
}

const FATAL_CODES = new Set([
  'insufficient_quota',
  'credit_balance_exhausted',
  'billing_hard_limit_reached',
  'billing_not_active',
  'invalid_api_key',
  'account_deactivated',
  'access_terminated',
  'authentication_error',
  'permission_error',
  'daily_quota_exhausted',
])

const FATAL_MESSAGE = /no credits remaining|insufficient[_ ]quota|exceeded your current quota|invalid api key|incorrect api key|api key not valid|api_key_invalid|credit balance is too low/i

type ErrorLike = {
  message?: unknown
  code?: unknown
  type?: unknown
  status?: unknown
  statusCode?: unknown
  error?: unknown
  responseBody?: unknown
  data?: unknown
  cause?: unknown
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function fromResponseBody(body: unknown): ErrorLike | undefined {
  if (typeof body !== 'string') return undefined
  try {
    const json = JSON.parse(body) as { error?: ErrorLike } | { error?: ErrorLike }[]
    const parsed = Array.isArray(json) ? json[0] : json
    return parsed?.error && typeof parsed.error === 'object' ? parsed.error : undefined
  } catch {
    return undefined
  }
}

/** Walk the nested shapes AI SDK / OpenAI / Anthropic use and pull out code + message. */
export function describeProviderError(error: unknown): ProviderErrorInfo {
  if (error == null) {
    return { fatal: false, message: 'Unknown model error' }
  }
  if (typeof error === 'string') {
    return { fatal: FATAL_MESSAGE.test(error), message: error }
  }

  const candidates: ErrorLike[] = []
  const queue: unknown[] = [error]
  while (queue.length > 0 && candidates.length < 8) {
    const next = queue.shift()
    if (!next || typeof next !== 'object') continue
    const item = next as ErrorLike
    candidates.push(item)
    queue.push(item.error, item.data, item.cause, fromResponseBody(item.responseBody))
  }

  let code: string | undefined
  let message: string | undefined
  let status: number | undefined
  for (const item of candidates) {
    code ??= asString(item.code) ?? (FATAL_CODES.has(String(item.type)) ? String(item.type) : undefined)
    const itemMessage = asString(item.message)
    if (itemMessage && itemMessage !== '[object Object]') {
      message ??= itemMessage
    }
    const itemStatus = Number(item.statusCode ?? item.status)
    if (Number.isFinite(itemStatus) && itemStatus > 0) {
      status ??= itemStatus
    }
  }

  const finalMessage = message || (code ? `Model provider error: ${code}` : 'Unknown model error')
  const fatal =
    (code !== undefined && FATAL_CODES.has(code)) ||
    status === 401 ||
    FATAL_MESSAGE.test(finalMessage)
  return { fatal, code, message: finalMessage }
}

export class ProviderFatalError extends Error {
  readonly code?: string
  readonly modelId: string

  constructor(modelId: string, info: ProviderErrorInfo) {
    super(info.message)
    this.name = 'ProviderFatalError'
    this.code = info.code
    this.modelId = modelId
  }

  /** Message shown in chat and the Details timeline. */
  get userMessage(): string {
    if (this.code === 'insufficient_quota' || this.code === 'credit_balance_exhausted') {
      return `The AI provider account is out of credits (${this.modelId}). Add credits to the provider account or switch model, then retry.`
    }
    if (this.code === 'daily_quota_exhausted') {
      return this.message
    }
    if (this.code === 'invalid_api_key' || this.code === 'authentication_error') {
      return `The AI provider rejected the API key (${this.modelId}). Update the key on the server, then retry.`
    }
    return `The AI provider refused the request (${this.modelId}): ${this.message}`
  }
}

export function isProviderFatalError(error: unknown): error is ProviderFatalError {
  return error instanceof ProviderFatalError
}
