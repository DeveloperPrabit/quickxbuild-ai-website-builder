/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * model-gateway-unit.test.ts — ModelGateway client, contracts, recorder and flags.
 * No network: fetch is injected.
 */

import { afterEach, describe, expect, it } from 'vitest'
import type { AgentEvent } from '../agent/runtime-events'
import { createModelGatewayClient, ModelGatewayError } from '../model-gateway/client'
import {
  isModelServiceEnabled,
  isTeacherEnabled,
  isTrajectoryRecordingEnabled,
} from '../model-gateway/config'
import { ActionProposal, type InferenceRequest } from '../model-gateway/contracts'
import { isEnvFile, redactSecrets } from '../model-gateway/sanitize'
import { createTrajectoryRecorder } from '../model-gateway/trajectory-recorder'

const FAKE_OPENAI_KEY = `sk-proj-${'A1b2C3d4'.repeat(4)}`

const REQUEST: InferenceRequest = {
  request_id: 'req-1',
  project_id: 'proj',
  task_id: 'task',
  prompt: 'Change heading',
  relevant_files: [],
  diagnostics: [],
  previous_tool_results: [],
  available_tools: ['write_file', 'apply_patch'],
  runtime_state: {
    phase: 'initial',
    repair_attempt: 0,
    build_failures: 0,
    preview_failures: 0,
    failed_tool_calls: 0,
    teacher_calls_so_far: 0,
  },
  allow_teacher: false,
}

function response(actions: unknown[]) {
  return {
    type: 'model_response',
    request_id: 'req-1',
    provider: 'test',
    model: 'quickxbuild-test-model',
    model_version: 'quickxbuild-model-v0',
    content: 'ok',
    confidence: 0.9,
    needs_teacher: false,
    escalation_reason: null,
    actions,
    teacher_used: false,
    teacher: null,
    usage: { input_tokens: 1, output_tokens: 1, estimated_cost_usd: 0 },
    latency_ms: 1,
    warnings: [],
  }
}

function ndjson(lines: unknown[], init?: ResponseInit) {
  return new Response(lines.map((line) => `${JSON.stringify(line)}\n`).join(''), {
    status: 200,
    headers: { 'Content-Type': 'application/x-ndjson' },
    ...init,
  })
}

const CONFIG = {
  url: 'http://model.local',
  token: 'svc-token',
  timeoutMs: 5000,
  trajectoryTimeoutMs: 5000,
}

describe('ModelGateway contracts', () => {
  it('rejects unsafe paths and unknown tools before they reach runtime tools', () => {
    const write = (path: string) =>
      ActionProposal.safeParse({ tool: 'write_file', path, content: 'x', description: 'd' }).success
    expect(write('src/App.tsx')).toBe(true)
    expect(write('../outside.ts')).toBe(false)
    expect(write('/etc/passwd')).toBe(false)
    expect(write('C:/Windows/x.ts')).toBe(false)
    expect(write('.env')).toBe(false)
    expect(write('node_modules/x/index.js')).toBe(false)
    expect(ActionProposal.safeParse({ tool: 'shell', command: 'rm -rf /' }).success).toBe(false)
    expect(
      ActionProposal.safeParse({ tool: 'install_packages', packages: ['lodash; rm -rf /'] }).success
    ).toBe(false)
    expect(ActionProposal.safeParse({ tool: 'run_build', extra: 'not allowed' }).success).toBe(
      false
    )
  })
})

describe('ModelGateway client', () => {
  it('streams NDJSON, forwards events and sends the bearer token server-side', async () => {
    const seen: Array<{ url: string; auth: string | null }> = []
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen.push({ url, auth: new Headers(init.headers).get('Authorization') })
      return ndjson([
        { event: 'model.status', version: 1, request_id: 'req-1', stage: 'model' },
        {
          event: 'model.final',
          version: 1,
          request_id: 'req-1',
          stage: 'done',
          response: response([]),
        },
      ])
    }) as unknown as typeof fetch
    const events: string[] = []
    const client = createModelGatewayClient(CONFIG, fetchImpl)
    const result = await client.infer(REQUEST, { onEvent: (e) => events.push(e.event) })
    expect(result.confidence).toBe(0.9)
    expect(events).toEqual(['model.status', 'model.final'])
    expect(seen[0]).toEqual({
      url: 'http://model.local/v1/inference/stream',
      auth: 'Bearer svc-token',
    })
  })

  it('rejects a final response containing an unsafe action', async () => {
    const fetchImpl = (async () =>
      ndjson([
        {
          event: 'model.final',
          version: 1,
          request_id: 'req-1',
          response: response([
            { tool: 'write_file', path: '../x', content: 'x', description: 'd' },
          ]),
        },
      ])) as unknown as typeof fetch
    await expect(createModelGatewayClient(CONFIG, fetchImpl).infer(REQUEST)).rejects.toMatchObject({
      code: 'invalid_model_response',
    })
  })

  it('surfaces model.failed and HTTP error envelopes as ModelGatewayError', async () => {
    const failed = (async () =>
      ndjson([
        {
          event: 'model.failed',
          version: 1,
          request_id: 'req-1',
          error_code: 'model_unavailable',
          error_message: 'down',
        },
      ])) as unknown as typeof fetch
    await expect(createModelGatewayClient(CONFIG, failed).infer(REQUEST)).rejects.toMatchObject({
      code: 'model_unavailable',
    })

    const unauthorized = (async () =>
      new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'bad token' } }), {
        status: 401,
      })) as unknown as typeof fetch
    const error = await createModelGatewayClient(CONFIG, unauthorized)
      .infer(REQUEST)
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ModelGatewayError)
    expect((error as ModelGatewayError).status).toBe(401)
  })

  it('fails when the stream ends without a final response', async () => {
    const fetchImpl = (async () =>
      ndjson([
        { event: 'model.status', version: 1, request_id: 'req-1' },
      ])) as unknown as typeof fetch
    await expect(createModelGatewayClient(CONFIG, fetchImpl).infer(REQUEST)).rejects.toMatchObject({
      code: 'incomplete_stream',
    })
  })

  it('maps network failures to model_unavailable', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    await expect(createModelGatewayClient(CONFIG, fetchImpl).infer(REQUEST)).rejects.toMatchObject({
      code: 'model_unavailable',
    })
  })
})

describe('trajectory recorder', () => {
  const event = (type: string, data: Record<string, unknown>) =>
    ({ type, ts: Date.UTC(2026, 0, 1), planId: 'p', data }) as unknown as AgentEvent

  it('records runtime events, marks action source, redacts secrets and stays ineligible', () => {
    const recorder = createTrajectoryRecorder({
      projectId: 'proj',
      taskId: 'task',
      prompt: `Use key ${FAKE_OPENAI_KEY}`,
      fileMap: {
        '.env': { content: `OPENAI_API_KEY=${FAKE_OPENAI_KEY}` },
        'src/App.tsx': { content: 'x' },
      },
      relevantPaths: ['.env', 'src/App.tsx'],
      model: { source: 'legacy_provider', provider: 'ai-sdk', model: 'default' },
    })
    recorder.observe(event('progress', { message: 'legacy' }))
    recorder.observe(event('step_start', { step: 'repair', title: 'Repair attempt 1' }))
    recorder.setActionSource('teacher')
    recorder.observe(
      event('tool_result', { tool: 'write_file', ok: false, detail: `bearer ${FAKE_OPENAI_KEY}` })
    )
    recorder.setActionSource(null)

    const payload = recorder.finalize({
      applied: true,
      writes: [{ path: 'src/App.tsx', content: 'y' }],
    })
    const types = payload.steps.map((s) => s.type)
    expect(types).toEqual(['step_start', 'repair_attempt', 'tool_result'])
    expect(payload.steps[2]?.tool).toBe('write_file')
    expect(payload.steps[2]?.data.source).toBe('teacher')
    expect(payload.training_eligible).toBe(false)
    expect(payload.teacher_used).toBe(false)
    const serialized = JSON.stringify(payload)
    expect(serialized).not.toContain(FAKE_OPENAI_KEY)
    expect(payload.initial_state.relevant_files.find((f) => f.path === '.env')?.content).toBe(
      '[REDACTED_ENV_FILE]'
    )
    expect(payload.trajectory_id).toMatch(/^[A-Za-z0-9_-]{8,64}$/)
  })
})

describe('sanitize', () => {
  it('redacts common credential formats and identifies env files', () => {
    expect(redactSecrets(`key=${FAKE_OPENAI_KEY}`)).toBe('key=[REDACTED]')
    expect(redactSecrets('postgres://user:pa55@db.local/x')).toBe(
      'postgres://[REDACTED]@db.local/x'
    )
    expect(isEnvFile('.env.local')).toBe(true)
    expect(isEnvFile('apps/web/.env')).toBe(true)
    expect(isEnvFile('.env.example')).toBe(false)
  })
})

describe('feature flags', () => {
  const keys = [
    'QUICKXBUILD_MODEL_SERVICE_ENABLED',
    'QUICKXBUILD_TEACHER_ENABLED',
    'QUICKXBUILD_TRAJECTORY_RECORDING_ENABLED',
    'MODEL_SERVICE_URL',
  ]
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]))
  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  it('are all off by default and require MODEL_SERVICE_URL', () => {
    for (const k of keys) delete process.env[k]
    expect(isModelServiceEnabled()).toBe(false)
    expect(isTeacherEnabled()).toBe(false)
    expect(isTrajectoryRecordingEnabled()).toBe(false)

    process.env.QUICKXBUILD_MODEL_SERVICE_ENABLED = 'true'
    process.env.QUICKXBUILD_TRAJECTORY_RECORDING_ENABLED = 'true'
    expect(isModelServiceEnabled()).toBe(false)
    expect(isTrajectoryRecordingEnabled()).toBe(false)

    process.env.MODEL_SERVICE_URL = 'http://localhost:3010'
    expect(isModelServiceEnabled()).toBe(true)
    expect(isTrajectoryRecordingEnabled()).toBe(true)
  })
})
