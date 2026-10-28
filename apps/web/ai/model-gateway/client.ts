/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * client.ts — Server-to-server client for services/model-server
 *
 * NDJSON streaming is consumed here and translated into existing runtime events by the
 * caller; the browser never talks to the model service.
 */

import type { ModelServiceConfig } from './config'
import {
  type InferenceRequest,
  InferenceResponse,
  ModelStreamEvent,
  type TrajectoryPayload,
} from './contracts'

export class ModelGatewayError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'ModelGatewayError'
  }
}

export type ModelGatewayClient = {
  infer(
    request: InferenceRequest,
    options?: { abortSignal?: AbortSignal; onEvent?: (event: ModelStreamEvent) => void }
  ): Promise<InferenceResponse>
  submitTrajectory(payload: TrajectoryPayload): Promise<{ trajectory_id: string }>
}

type FetchLike = typeof fetch

function withTimeout(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

async function errorFrom(response: Response): Promise<ModelGatewayError> {
  let code = 'http_error'
  let message = `model service returned HTTP ${response.status}`
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } }
    if (body.error?.code) code = body.error.code
    if (body.error?.message) message = body.error.message
  } catch {
    // keep defaults
  }
  return new ModelGatewayError(message, code, response.status)
}

function parseResponse(raw: unknown): InferenceResponse {
  const parsed = InferenceResponse.safeParse(raw)
  if (!parsed.success) {
    const where = parsed.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.code}`)
      .join('; ')
    throw new ModelGatewayError(
      `model service response failed validation (${parsed.error.issues.length} issues: ${where})`,
      'invalid_model_response'
    )
  }
  return parsed.data
}

export function createModelGatewayClient(
  config: ModelServiceConfig,
  fetchImpl: FetchLike = fetch
): ModelGatewayClient {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.token) headers.Authorization = `Bearer ${config.token}`

  const post = async (path: string, body: unknown, timeoutMs: number, signal?: AbortSignal) => {
    try {
      return await fetchImpl(`${config.url}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: withTimeout(timeoutMs, signal),
      })
    } catch (error) {
      const name = error instanceof Error ? error.name : ''
      if (name === 'TimeoutError') {
        throw new ModelGatewayError('model service timed out', 'timeout')
      }
      if (name === 'AbortError') {
        throw new ModelGatewayError('request aborted', 'aborted')
      }
      throw new ModelGatewayError('model service unreachable', 'model_unavailable')
    }
  }

  return {
    async infer(request, options) {
      const response = await post(
        '/v1/inference/stream',
        request,
        config.timeoutMs,
        options?.abortSignal
      )
      if (!response.ok || !response.body) throw await errorFrom(response)

      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
      let buffer = ''
      let final: InferenceResponse | null = null
      const handleLine = (line: string) => {
        if (!line.trim()) return
        let json: unknown
        try {
          json = JSON.parse(line)
        } catch {
          throw new ModelGatewayError('model service sent invalid NDJSON', 'invalid_model_response')
        }
        const event = ModelStreamEvent.safeParse(json)
        if (!event.success) return
        options?.onEvent?.(event.data)
        if (event.data.event === 'model.final') final = parseResponse(event.data.response)
        if (event.data.event === 'model.failed') {
          throw new ModelGatewayError(
            event.data.error_message || 'model inference failed',
            event.data.error_code || 'model_failed'
          )
        }
      }
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += value
        let newline = buffer.indexOf('\n')
        while (newline !== -1) {
          handleLine(buffer.slice(0, newline))
          buffer = buffer.slice(newline + 1)
          newline = buffer.indexOf('\n')
        }
      }
      handleLine(buffer)
      if (!final) {
        throw new ModelGatewayError(
          'model stream ended without a final response',
          'incomplete_stream'
        )
      }
      return final
    },

    async submitTrajectory(payload) {
      const response = await post('/v1/trajectories', payload, config.trajectoryTimeoutMs)
      if (!response.ok) throw await errorFrom(response)
      const body = (await response.json()) as { trajectory_id?: unknown }
      if (typeof body.trajectory_id !== 'string') {
        throw new ModelGatewayError('trajectory response missing id', 'invalid_response')
      }
      return { trajectory_id: body.trajectory_id }
    },
  }
}
