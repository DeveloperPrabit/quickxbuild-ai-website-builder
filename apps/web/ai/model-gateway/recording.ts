/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * recording.ts — Opt-in trajectory recording around one Agent Runtime generation.
 *
 * Enabled by QUICKXBUILD_TRAJECTORY_RECORDING_ENABLED. Submission happens after the
 * project mutation lock is released and never fails the user's request.
 */

import { randomUUID } from 'node:crypto'
import { pickRelevantFiles } from '../agent/relevant'
import type { AgentEvent } from '../agent/runtime-events'
import type { AgentRunGateResult } from '../agent/runtime-gate'
import { createModelGatewayClient, type ModelGatewayClient } from './client'
import { getModelServiceConfig, isTrajectoryRecordingEnabled } from './config'
import { createTrajectoryRecorder, type TrajectoryRecorder } from './trajectory-recorder'

export type TrajectoryRecording = {
  recorder: TrajectoryRecorder
  onAgentEvent: (event: AgentEvent) => void
  submit(result: {
    applied: boolean
    writes: Array<{ path: string; content: string }>
    gate?: AgentRunGateResult
    error?: string
  }): Promise<string | null>
}

export function startTrajectoryRecording(params: {
  projectId?: string
  planId?: string
  prompt: string
  fileMap: Record<string, { content?: string }>
  modelId?: string
  onAgentEvent?: (event: AgentEvent) => void
  client?: ModelGatewayClient
}): TrajectoryRecording | null {
  if (!params.client && !isTrajectoryRecordingEnabled()) return null
  const config = getModelServiceConfig()
  const client = params.client || (config ? createModelGatewayClient(config) : null)
  if (!client) return null

  const recorder = createTrajectoryRecorder({
    projectId: params.projectId || 'unknown',
    taskId: params.planId || `task-${randomUUID()}`,
    planId: params.planId,
    prompt: params.prompt.slice(0, 100_000),
    fileMap: params.fileMap,
    relevantPaths: pickRelevantFiles(params.fileMap, params.prompt),
    model: { source: 'legacy_provider', provider: 'ai-sdk', model: params.modelId || 'default' },
  })

  return {
    recorder,
    onAgentEvent: (event) => {
      try {
        recorder.observe(event)
      } catch (error) {
        console.warn('[trajectory] failed to record event', error)
      }
      params.onAgentEvent?.(event)
    },
    async submit(result) {
      try {
        const { trajectory_id } = await client.submitTrajectory(recorder.finalize(result))
        return trajectory_id
      } catch (error) {
        console.warn(
          `[trajectory] submission failed: ${error instanceof Error ? error.message : String(error)}`
        )
        return null
      }
    },
  }
}
