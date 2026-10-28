import { afterEach, describe, expect, it, vi } from 'vitest'

const envState = vi.hoisted(() => ({
  GEMINI_API_KEY: 'test-key' as string | undefined,
  MODEL_API_KEY: undefined as string | undefined,
}))

vi.mock('@/env.mjs', () => ({ env: envState }))

vi.mock('../providers', () => ({
  GEMINI_FALLBACK_MODEL_ID: 'chat-model-gemini-flash',
  GEMINI_FALLBACK_MODEL_NAME: 'gemini-2.5-flash',
  MUSE_MODEL_ID: 'chat-model-reasoning-muse',
  MUSE_MODEL_NAME: 'muse-spark-1.3',
  isMuseConfigured: () => Boolean(envState.MODEL_API_KEY),
  myProvider: {
    languageModel: (id: string) => ({ modelId: id }),
  },
}))

import {
  OPENAI_REFUSAL_TTL_MS,
  failOverFromOpenAI,
  failoverNotice,
  isOpenAIRefused,
  languageModelFor,
  markOpenAIRefused,
  resetProviderFailover,
  resolveModelId,
} from '../provider-failover'

const OPENAI = 'chat-model-reasoning-openai'
const quota = { fatal: true, code: 'insufficient_quota', message: 'quota' }

describe('provider failover', () => {
  afterEach(() => {
    resetProviderFailover()
    envState.GEMINI_API_KEY = 'test-key'
    envState.MODEL_API_KEY = undefined
    vi.restoreAllMocks()
  })

  it('routes OpenAI and Gemini ids to Muse when MODEL_API_KEY is set', () => {
    envState.MODEL_API_KEY = 'LLM_test'
    expect(resolveModelId(OPENAI)).toBe('chat-model-reasoning-muse')
    expect(resolveModelId('chat-model-gemini-flash')).toBe('chat-model-reasoning-muse')
  })

  it('uses OpenAI while it has not refused', () => {
    expect(resolveModelId(OPENAI)).toBe(OPENAI)
    expect(languageModelFor(OPENAI)).toEqual({ modelId: OPENAI })
  })

  it('switches to Gemini after a fatal OpenAI error and retries OpenAI after the TTL', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(failOverFromOpenAI(OPENAI, quota)).toBe(true)
    expect(resolveModelId(OPENAI)).toBe('chat-model-gemini-flash')
    expect(isOpenAIRefused(Date.now() + OPENAI_REFUSAL_TTL_MS + 1)).toBe(false)
  })

  it('does not fail over for retryable errors, non-OpenAI models, or a missing Gemini key', () => {
    expect(failOverFromOpenAI(OPENAI, { fatal: false, message: 'rate limit' })).toBe(false)
    expect(failOverFromOpenAI('chat-model-gemini-flash', quota)).toBe(false)
    envState.GEMINI_API_KEY = undefined
    expect(failOverFromOpenAI(OPENAI, quota)).toBe(false)
    markOpenAIRefused()
    expect(resolveModelId(OPENAI)).toBe(OPENAI)
  })

  it('leaves non-OpenAI models alone while OpenAI is refused', () => {
    markOpenAIRefused()
    expect(resolveModelId('chat-model-reasoning-azure')).toBe('chat-model-reasoning-azure')
  })

  it('explains the switch', () => {
    expect(failoverNotice(quota)).toBe(
      'OpenAI is out of credits — continuing with gemini-2.5-flash.'
    )
    expect(failoverNotice({ fatal: true, code: 'invalid_api_key', message: 'bad' })).toContain(
      'OpenAI rejected the request'
    )
  })
})
