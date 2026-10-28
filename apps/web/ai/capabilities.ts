/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * capabilities.ts
 * Copyright (C) 2025 Nextify Limited
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 */

import { AUTO_MODEL_ID, canAccessModel, findModelById } from '@/configs/ai-models'
import { isMuseConfigured, MUSE_MODEL_ID } from './providers'

/** Provider ids used by capability routing. */
export const PROVIDER_IDS = {
  MUSE: MUSE_MODEL_ID,
  ASTRA: 'chat-model-reasoning-openai-astra',
  GPT_41: 'chat-model-reasoning-openai',
  MINI: 'chat-model-reasoning-openai-mini',
  ANTHROPIC: 'chat-model-reasoning-anthropic',
  GOOGLE: 'chat-model-reasoning-google',
  IMAGE: 'openai-image',
} as const

/** Models assigned to each generation step. */
export type CapabilityBundle = {
  reason: string
  code: string
  fast: string
  vision: string
  image: string
}

const PICKER_TO_PROVIDER: Record<string, string> = {
  'muse-spark': PROVIDER_IDS.MUSE,
  'gpt-6-astra': PROVIDER_IDS.ASTRA,
  'gpt-4-1': PROVIDER_IDS.GPT_41,
  'gpt-4-1-mini': PROVIDER_IDS.MINI,
  'claude-4-0-sonnet': PROVIDER_IDS.ANTHROPIC,
  'gemini-2-5-pro': PROVIDER_IDS.GOOGLE,
}

function isAutoSelection(selectedModelId?: string): boolean {
  return !selectedModelId || selectedModelId === AUTO_MODEL_ID
}

function openaiReason(userPlan: string): string {
  return canAccessModel(userPlan, 'gpt-6-astra') ? PROVIDER_IDS.ASTRA : PROVIDER_IDS.GPT_41
}

function assertPinnedAccess(userPlan: string, selectedModelId?: string) {
  if (isAutoSelection(selectedModelId) || !selectedModelId) {
    return
  }
  if (canAccessModel(userPlan, selectedModelId)) {
    return
  }
  const requestedModel = findModelById(selectedModelId)
  throw new Error(
    `Access denied: ${requestedModel.name} requires ${requestedModel.requiredPlan} subscription. Current plan: ${userPlan}`
  )
}

/**
 * Route existing generation steps by code path. Pinning overrides reason and code only.
 * `isFileEdit` does not change the bundle; callers use `fast` for file-edit.
 *
 * When MODEL_API_KEY is set, Meta Muse Spark is the primary chat model for Auto and for
 * all text capabilities (reason/code/fast/vision). Image generation still uses openai-image.
 */
export function selectCapabilities(
  userPlan: string,
  selectedModelId?: string,
  _isFileEdit = false
): CapabilityBundle {
  assertPinnedAccess(userPlan, selectedModelId)

  const image = PROVIDER_IDS.IMAGE

  if (isMuseConfigured()) {
    // Auto and all text pins → Muse so chat does not call OpenAI/Gemini/Claude while configured.
    const muse = PROVIDER_IDS.MUSE
    return { reason: muse, code: muse, fast: muse, vision: muse, image }
  }

  const vision = openaiReason(userPlan)
  const fast = PROVIDER_IDS.MINI
  const pinnedProvider = selectedModelId ? PICKER_TO_PROVIDER[selectedModelId] : undefined
  const reason = isAutoSelection(selectedModelId) || !pinnedProvider
    ? openaiReason(userPlan)
    : pinnedProvider
  const code = reason

  return { reason, code, fast, vision, image }
}
