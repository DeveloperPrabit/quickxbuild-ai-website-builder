/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * models.ts
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

import { env } from '@/env.mjs'
import type { AnthropicProviderOptions } from '@ai-sdk/anthropic'
import { isMuseConfigured } from './providers'

export { selectCapabilities } from './capabilities'
export { selectAgentModels, selectModel } from './select-models'

/**
 * Build provider options for AI model
 * @param options.reasoningSummary request user-facing reasoning summaries from OpenAI
 * reasoning models (ignored by non-reasoning models). Some orgs must be verified first.
 *
 * Muse Spark always reasons; keep effort low so completion tokens remain for tool/JSON output.
 */
export const buildProviderOptions = (options?: { reasoningSummary?: boolean }) => ({
  anthropic: {
    thinking: { type: 'enabled', budgetTokens: 4096 },
  } satisfies AnthropicProviderOptions,
  openai: {
    ...(isMuseConfigured()
      ? { reasoningEffort: 'low' as const }
      : env.REASONING_ENABLED
        ? { reasoningEffort: 'medium' as const }
        : {}),
    ...(!isMuseConfigured() && options?.reasoningSummary ? { reasoningSummary: 'auto' } : {}),
  },
})
