import { env } from '@/env.mjs'
import { log } from '@quickxbuild/common'
import { failedBrief, parseIntegrationBrief, type IntegrationBrief } from './brief'
import { detectIntegrations, preferredHosts, type DetectedProvider } from './detect-integrations'

const SEARCH_TIMEOUT_MS = 15_000

function buildSearchPrompt(userPrompt: string, providers: DetectedProvider[]): string {
  const hosts = preferredHosts(providers)
  const hostHint = hosts.length > 0
    ? `Prefer official documentation on: ${hosts.join(', ')}.`
    : 'Prefer official vendor documentation. Label unofficial sources as unverified.'

  return `Search current official docs for the third-party APIs needed by this app request.
${hostHint}
Return ONLY JSON with this shape:
{
  "summary": "one sentence",
  "providers": [{
    "id": "stripe",
    "official": true,
    "urls": ["https://..."],
    "endpoints": [{ "method": "POST", "path": "/v1/checkout/sessions", "purpose": "create checkout" }],
    "envNames": ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
    "webhookPath": "/api/webhooks/stripe",
    "pitfalls": ["verify webhook signatures"]
  }],
  "constraints": ["never put secret values in source", "use test mode on localhost"]
}
Rules:
- envNames are names only, never values
- Use the generated-app Node Hono API (not QuickXBuild platform billing)
- Payments persist rows as pending/paid/failed
User request:
${userPrompt}`
}

function extractOutputText(payload: any): string {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text
  }

  const responseChunks = Array.isArray(payload?.output) ? payload.output : []
  const fromResponses = responseChunks
    .flatMap((item: any) => item?.content || [])
    .map((part: any) => part?.text || part?.output_text || '')
    .join('\n')
  if (fromResponses.trim()) {
    return fromResponses
  }

  const choice = payload?.choices?.[0]?.message?.content
  if (typeof choice === 'string') {
    return choice
  }
  if (Array.isArray(choice)) {
    return choice.map((part: any) => part?.text || '').join('\n')
  }
  return ''
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function searchViaResponses(apiKey: string, prompt: string): Promise<string> {
  const response = await fetchWithTimeout('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      tools: [{ type: 'web_search' }],
      input: prompt,
    }),
  })
  if (!response.ok) {
    throw new Error(`Responses search failed: ${response.status}`)
  }
  return extractOutputText(await response.json())
}

async function searchViaChat(apiKey: string, prompt: string): Promise<string> {
  const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini-search-preview',
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!response.ok) {
    throw new Error(`Search preview failed: ${response.status}`)
  }
  return extractOutputText(await response.json())
}

/**
 * OpenAI web search, then a structured brief. Fail open so codegen still runs.
 */
export async function searchIntegrationDocs(
  userPrompt: string,
  options: { abortSignal?: AbortSignal } = {}
): Promise<IntegrationBrief> {
  const providers = detectIntegrations(userPrompt)
  const apiKey = env.OPENAI_API_KEY

  if (!apiKey) {
    return failedBrief('OPENAI_API_KEY is missing; codegen will continue without live docs.', providers.map((item) => item.id))
  }

  if (options.abortSignal?.aborted) {
    return failedBrief('Search aborted.', providers.map((item) => item.id))
  }

  try {
    const prompt = buildSearchPrompt(userPrompt, providers)
    let raw = ''
    try {
      raw = await searchViaResponses(apiKey, prompt)
    } catch (error) {
      log.ai('warn', 'Responses web search failed, trying search-preview chat', {
        operation: 'docs-search',
        error: error instanceof Error ? error.message : String(error),
      })
      raw = await searchViaChat(apiKey, prompt)
    }

    const parsed = parseIntegrationBrief(raw)
    if (!parsed) {
      return failedBrief('Search returned unreadable docs. Do not invent APIs.', providers.map((item) => item.id))
    }
    return parsed
  } catch (error) {
    log.ai('warn', 'Integration docs search failed open', {
      operation: 'docs-search',
      error: error instanceof Error ? error.message : String(error),
    })
    return failedBrief(
      error instanceof Error ? error.message : 'Docs search failed',
      providers.map((item) => item.id)
    )
  }
}
