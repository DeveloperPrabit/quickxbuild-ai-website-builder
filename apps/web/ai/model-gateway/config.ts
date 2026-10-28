/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * config.ts — Feature flags for the QuickXBuild model service (all default OFF)
 */

const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_TRAJECTORY_TIMEOUT_MS = 10_000

function flag(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes' || value === 'on'
}

export type ModelServiceConfig = {
  url: string
  token?: string
  timeoutMs: number
  trajectoryTimeoutMs: number
}

/** Server-side only. The token never reaches the browser. */
export function getModelServiceConfig(): ModelServiceConfig | null {
  const url = process.env.MODEL_SERVICE_URL?.trim()
  if (!url) return null
  const timeout = Number(process.env.MODEL_SERVICE_TIMEOUT_MS)
  return {
    url: url.replace(/\/+$/, ''),
    token: process.env.MODEL_SERVICE_TOKEN?.trim() || undefined,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS,
    trajectoryTimeoutMs: DEFAULT_TRAJECTORY_TIMEOUT_MS,
  }
}

/** Route Agent Runtime generation through the ModelGateway (QuickXBuild model). */
export function isModelServiceEnabled(): boolean {
  return flag('QUICKXBUILD_MODEL_SERVICE_ENABLED') && getModelServiceConfig() !== null
}

/** Allow the model service to escalate to the Teacher Model for this runtime. */
export function isTeacherEnabled(): boolean {
  return flag('QUICKXBUILD_TEACHER_ENABLED')
}

/** Record development trajectories (sanitized server-side, training_eligible=false). */
export function isTrajectoryRecordingEnabled(): boolean {
  return flag('QUICKXBUILD_TRAJECTORY_RECORDING_ENABLED') && getModelServiceConfig() !== null
}
