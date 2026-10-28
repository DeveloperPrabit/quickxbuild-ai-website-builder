/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * generate.ts
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

import { tryCatch } from '@quickxbuild/common'
import { streamText } from 'ai'
import {
  APPLY_RETRY_SUFFIX,
  hasFileActionXml,
  requiresApply,
  runAgentLoop,
  shouldUseAgentLoop,
  stringToTextStream,
} from './agent'
import { appendDurableMutationToProjectHistory } from './agent/durable-history'
import { normalizeFileMap } from './agent/file-map'
import { shouldFallBackToXmlCompatibility } from './agent/generation-outcome'
import { runPhase3InstallBuildRepair } from './agent/phase3-pipeline'
import { withProjectMutationLock } from './agent/project-mutation-lock'
import { resolveProjectSandboxFilesystem } from './agent/project-sandbox'
import { formatRelevantFiles, pickRelevantFiles } from './agent/relevant'
import { createRuntimeEmitter } from './agent/runtime-emitter'
import type { AgentEvent } from './agent/runtime-events'
import type { AgentRunGateResult } from './agent/runtime-gate'
import { createPersistMutationFn } from './agent/tools'
import type { AgentWrite } from './agent/xml'
import { acceptXmlCompatibilityWrites, parseXmlCompatibilityWrites } from './agent/xml-adapter'
import { selectCapabilities } from './capabilities'
import { buildGenerationContext, fetchProjectData, validateQuota } from './context'
import { inferCompleteness } from './design/completeness'
import {
  formatDesignMessage,
  formatDesignXml,
  needsDesignSpec,
  prepareDesignSpec,
} from './design/figma'
import {
  analyzeProductBlueprint,
  applyBlueprintToDesignSpec,
  blueprintToCompleteness,
  buildPlanFromBlueprint,
  buildSiteResearch,
  formatProductBlueprintXml,
  formatSiteResearchXml,
  type ProductBlueprint,
} from './design/product-blueprint'
import { buildLocalDesignSpec, type DesignSpec } from './design/spec'
import { analyzeDesignImage } from './design/vision'
import { buildProviderOptions } from './models'
import { languageModelFor } from './provider-failover'
import { formatBriefXml, type IntegrationBrief } from './research/brief'
import { needsDocsSearch } from './research/detect-integrations'
import { searchIntegrationDocs } from './research/docs-search'
import type { GenerationConfig, GenerationMessage, ImageData, SelectedItem } from './types.js'
import {
  buildMessageContent,
  buildSelectedElementsInfo,
  buildUserPrompt,
  prepareSystemPrompt,
  validateAbortSignal,
} from './utils'

export type GenerationStreamResult = {
  textStream: ReadableStream<string>
  research: IntegrationBrief | null
  designNote: string | null
  writes: AgentWrite[]
  /**
   * True when writes were already persisted by Agent Runtime (tools or XML adapter).
   * Route / client must not append a second history row or re-deploy to sandbox.
   * This is NOT overall generation success — see `phase3Gate`.
   */
  persistedByAgentRuntime?: boolean
  /**
   * Authoritative Phase 3 acceptance gate when install/build/preview ran.
   * When present, `phase3Gate.success` decides mutation success — not `applied` alone.
   */
  phase3Gate?: AgentRunGateResult
  /**
   * Operation kind: mutation vs read_only. Required to evaluate ledger build status.
   */
  operation?: 'mutation' | 'read_only'
}

export {
  resolveAiExecutionBuildStatus,
  shouldFallBackToXmlCompatibility,
} from './agent/generation-outcome'

// ============================================================================
// Core Generation Functions
// ============================================================================

export const generateStreamResponse = async (
  prompt: string,
  projectId: string,
  selectedItems: SelectedItem[] = [],
  imageData?: ImageData | null,
  abortSignal?: AbortSignal,
  config: GenerationConfig = { isFileEdit: false, quotaType: 'ai' },
  onProgress?: (message: string) => void,
  onTimeline?: (step: {
    kind: 'thought' | 'check' | 'edit' | 'verify' | 'summary'
    title: string
    detail?: string
    path?: string
    durationMs?: number
    status?: 'running' | 'done' | 'failed'
    id?: string
  }) => void,
  planId?: string,
  onAgentEvent?: (event: AgentEvent) => void
) => {
  const [result, error] = await tryCatch(async () => {
    validateAbortSignal(abortSignal)

    onProgress?.('Checking your project…')

    // Fetch and validate project data
    const projectData = await fetchProjectData(projectId)

    // Check quota based on operation type
    await validateQuota(projectData.organizationId, config.quotaType)

    // Build generation context
    const context = await buildGenerationContext(projectData, config)

    // Prepare prompts and messages
    let research: IntegrationBrief | null = null
    let designNote: string | null = null
    let designXml: string | null = null
    let design: DesignSpec | null = null
    let blueprint: ProductBlueprint | null = null
    let siteResearchXml = ''

    // Phase 1: prompt analyzer → site research → visible build plan (full builds only)
    if (!config.isFileEdit) {
      blueprint = analyzeProductBlueprint(prompt, { hasDesign: Boolean(imageData) })
      if (blueprint) {
        onProgress?.(`Analyzing ${blueprint.brandName} (${blueprint.vertical})…`)
        const siteResearch = buildSiteResearch(prompt, blueprint)
        blueprint = { ...blueprint, researchNote: siteResearch.audience }
        siteResearchXml = formatSiteResearchXml(siteResearch)
        onProgress?.(
          `Research: ${siteResearch.sectionIdeas.slice(0, 3).join(' · ')}${siteResearch.sectionIdeas.length > 3 ? '…' : ''}`
        )
        if (planId && onAgentEvent) {
          onAgentEvent({
            type: 'build_plan',
            version: 1,
            planId,
            data: {
              brandName: blueprint.brandName,
              vertical: blueprint.vertical,
              items: buildPlanFromBlueprint(blueprint),
            },
          })
        }
        onTimeline?.({
          kind: 'check',
          title: `Build plan: ${blueprint.brandName}`,
          detail: blueprint.pages.map((p) => p.path).join(', '),
          status: 'done',
          id: 'build-plan',
        })
      }
    }

    if (needsDocsSearch(prompt, config.isFileEdit)) {
      research = await searchIntegrationDocs(prompt, { abortSignal })
    }
    if (imageData && !config.isFileEdit) {
      try {
        design = await analyzeDesignImage(
          imageData,
          prompt,
          context.userPlan,
          config.modelId,
          abortSignal
        )
        designNote = 'Matched uploaded or pasted design screens. Build those pages exactly.'
      } catch (visionError) {
        console.error('Vision design analysis failed:', visionError)
        design = blueprint
          ? applyBlueprintToDesignSpec(blueprint)
          : buildLocalDesignSpec(prompt)
        design.warning = 'Vision analysis failed. Using prompt completeness only.'
        designNote = formatDesignMessage(design)
      }
    } else if (needsDesignSpec(prompt, config.isFileEdit, false)) {
      design = await prepareDesignSpec(prompt)
      if (blueprint) {
        design = applyBlueprintToDesignSpec(blueprint, design)
      }
      designNote = formatDesignMessage(design)
    } else if (blueprint) {
      design = applyBlueprintToDesignSpec(blueprint)
      designNote = formatDesignMessage(design)
    }
    if (design) {
      designXml = formatDesignXml(design)
    }

    const completeness = blueprint
      ? blueprintToCompleteness(blueprint)
      : inferCompleteness(prompt, design?.pages.map((page) => page.path) || [], {
          hasDesign: Boolean(design),
        })

    const extraContext = [
      blueprint ? formatProductBlueprintXml(blueprint) : '',
      siteResearchXml,
      research ? formatBriefXml(research) : '',
      designXml || '',
      completeness.length > 0
        ? `<completeness>${completeness.map((item) => `${item.path} — ${item.title}`).join('\n')}</completeness>`
        : '',
    ]
      .filter(Boolean)
      .join('\n')

    const mustApply = requiresApply(prompt, config.isFileEdit)
    const compactFiles = formatRelevantFiles(
      normalizeFileMap(context.fileMap),
      pickRelevantFiles(context.fileMap, prompt)
    )
    const capabilities = selectCapabilities(context.userPlan, config.modelId, config.isFileEdit)
    const xmlModels = config.isFileEdit
      ? [...new Set([capabilities.fast, capabilities.code])]
      : [...new Set([capabilities.code, capabilities.fast])]

    if (shouldUseAgentLoop()) {
      onProgress?.('Agent is working on your files…')
      const sandbox = await resolveProjectSandboxFilesystem({
        projectId: context.projectData.id,
        containerId: context.projectData.containerId,
        initialFiles: context.fileMap,
      })

      const [loopResult, loopError] = await tryCatch(async () =>
        runAgentLoop({
          prompt: prompt + buildSelectedElementsInfo(selectedItems),
          xmlFiles: compactFiles,
          knowledge: context.projectData.knowledge,
          extraContext,
          messageHistory: context.projectData.messageHistory,
          fileMap: context.fileMap,
          userPlan: context.userPlan,
          modelId: config.modelId,
          isFileEdit: config.isFileEdit,
          abortSignal,
          completeness,
          blueprint,
          planId,
          projectId: context.projectData.id,
          sandbox,
          appendDurableHistory: (record) =>
            appendDurableMutationToProjectHistory(context.projectData.id, record),
          onAgentEvent,
          onProgress,
          onTimeline,
        })
      )
      if (!loopError && loopResult) {
        // Phase 3 already ran — return authoritative gate; NEVER fall through to XML.
        if (loopResult.phase3Gate) {
          return {
            textStream: loopResult.textStream,
            research,
            designNote,
            writes: loopResult.writes,
            persistedByAgentRuntime: Boolean(loopResult.applied && sandbox),
            phase3Gate: loopResult.phase3Gate,
            operation: mustApply ? 'mutation' : 'read_only',
          }
        }
        // No Phase 3: applied writes or read-only — done (no XML second writer).
        if (loopResult.applied || !mustApply) {
          return {
            textStream: loopResult.textStream,
            research,
            designNote,
            writes: loopResult.writes,
            persistedByAgentRuntime: Boolean(loopResult.applied && sandbox),
            operation: mustApply ? 'mutation' : 'read_only',
          }
        }
      }

      // XML fallback only when tool loop errored or produced no applicable mutation
      // BEFORE Phase 3 ran (mustApply && !applied && !phase3Gate).
      if (
        !shouldFallBackToXmlCompatibility({
          mustApply,
          loopError,
          loopResult,
        })
      ) {
        // Defensive: mustApply without writes and without Phase 3 — empty failed result
        return {
          textStream: loopResult?.textStream || stringToTextStream(''),
          research,
          designNote,
          writes: loopResult?.writes || [],
          persistedByAgentRuntime: Boolean(loopResult?.applied && sandbox),
          phase3Gate: loopResult?.phase3Gate,
          operation: mustApply ? 'mutation' : 'read_only',
        }
      }

      console.error('Agent tool loop failed, falling back to XML compatibility adapter:', loopError)
      onProgress?.('Retrying another approach…')

      // Phase 4: XML fallback must still use the single persist pipeline (not RAM-only writes).
      return persistXmlCompatibilityFallback({
        systemPromptText: mustApply
          ? `${prepareSystemPrompt()}\n\nIf the user asked to implement, fix, add, or change code, you MUST include at least one <action type="file">. Plan-only replies are invalid.`
          : prepareSystemPrompt(),
        userPrompt: buildUserPrompt(
          mustApply ? compactFiles : context.xmlFiles,
          prompt + buildSelectedElementsInfo(selectedItems),
          context.projectData.knowledge,
          research ? formatBriefXml(research) : null,
          designXml
        ),
        imageData,
        xmlModels,
        mustApply,
        abortSignal,
        research,
        designNote,
        projectId: context.projectData.id,
        planId: planId || 'pending',
        sandbox,
        fileMap: normalizeFileMap(context.fileMap),
        appendDurableHistory: (record) =>
          appendDurableMutationToProjectHistory(context.projectData.id, record),
        onAgentEvent,
        onProgress,
        onTimeline,
      })
    }

    // Agent loop disabled — XML compatibility path still requires authoritative persist when mutating.
    const sandbox = mustApply
      ? await resolveProjectSandboxFilesystem({
          projectId: context.projectData.id,
          containerId: context.projectData.containerId,
          initialFiles: context.fileMap,
        })
      : null

    const systemPromptText = mustApply
      ? `${prepareSystemPrompt()}\n\nIf the user asked to implement, fix, add, or change code, you MUST include at least one <action type="file">. Plan-only replies are invalid.`
      : prepareSystemPrompt()
    const selectedElementsInfo = buildSelectedElementsInfo(selectedItems)
    const userPrompt = buildUserPrompt(
      mustApply ? compactFiles : context.xmlFiles,
      prompt + selectedElementsInfo,
      context.projectData.knowledge,
      research ? formatBriefXml(research) : null,
      designXml
    )
    const messageContent = buildMessageContent(userPrompt, imageData)

    const messages: GenerationMessage[] = [
      {
        role: 'user',
        content: messageContent,
      },
    ]

    if (!mustApply) {
      const streamResult = streamText({
        model: languageModelFor(
          config.isFileEdit ? capabilities.fast : capabilities.reason
        ),
        system: systemPromptText,
        messages,
        ...(abortSignal && { abortSignal }),
        providerOptions: buildProviderOptions(),
      })
      return {
        textStream: streamResult.textStream,
        research,
        designNote,
        writes: [],
        persistedByAgentRuntime: false,
        operation: 'read_only',
      }
    }

    return persistXmlCompatibilityFallback({
      systemPromptText,
      userPrompt,
      imageData,
      xmlModels,
      mustApply,
      abortSignal,
      research,
      designNote,
      projectId: context.projectData.id,
      planId: planId || 'pending',
      sandbox,
      fileMap: normalizeFileMap(context.fileMap),
      appendDurableHistory: (record) =>
        appendDurableMutationToProjectHistory(context.projectData.id, record),
      onAgentEvent,
      onProgress,
      onTimeline,
    })
  })

  if (error) {
    const operation = config.isFileEdit ? 'streamGenerateAppForFileEdit' : 'streamGenerateApp'
    console.error(`Error in ${operation}:`, error)
    throw error
  }

  return result
}

/**
 * Phase 4: generate XML for compatibility, then ONLY accept writes through
 * acceptRuntimeWrites → persistMutation. Never return raw extracted XML as authoritative.
 */
async function persistXmlCompatibilityFallback(input: {
  systemPromptText: string
  userPrompt: string
  imageData?: ImageData | null
  xmlModels: string[]
  mustApply: boolean
  abortSignal?: AbortSignal
  research: IntegrationBrief | null
  designNote: string | null
  projectId: string
  planId: string
  sandbox: Awaited<ReturnType<typeof resolveProjectSandboxFilesystem>> | null
  fileMap: Record<string, { content?: string }>
  appendDurableHistory: (
    record: import('./agent/persist-mutation').DurableMutationRecord
  ) => Promise<void>
  onAgentEvent?: (event: AgentEvent) => void
  onProgress?: (message: string) => void
  onTimeline?: (step: {
    kind: 'thought' | 'check' | 'edit' | 'verify' | 'summary'
    title: string
    detail?: string
    path?: string
    durationMs?: number
    status?: 'running' | 'done' | 'failed'
    id?: string
  }) => void
}): Promise<GenerationStreamResult> {
  let text = ''
  let extracted: AgentWrite[] = []

  for (const modelId of input.xmlModels) {
    try {
      const streamResult = streamText({
        model: languageModelFor(modelId),
        system: input.systemPromptText,
        messages: [
          {
            role: 'user',
            content: buildMessageContent(input.userPrompt, input.imageData),
          },
        ],
        ...(input.abortSignal && { abortSignal: input.abortSignal }),
        providerOptions: buildProviderOptions(),
      })
      text = ''
      for await (const chunk of streamResult.textStream) {
        text += chunk
      }
      extracted = parseXmlCompatibilityWrites(text)
      if (extracted.length > 0 || hasFileActionXml(text)) {
        break
      }

      const retry = streamText({
        model: languageModelFor(modelId),
        system: input.systemPromptText,
        messages: [
          {
            role: 'user',
            content: buildMessageContent(
              `${input.userPrompt}${APPLY_RETRY_SUFFIX}`,
              input.imageData
            ),
          },
        ],
        ...(input.abortSignal && { abortSignal: input.abortSignal }),
        providerOptions: buildProviderOptions(),
      })
      text = ''
      for await (const chunk of retry.textStream) {
        text += chunk
      }
      extracted = parseXmlCompatibilityWrites(text)
      if (extracted.length > 0 || hasFileActionXml(text)) {
        break
      }
    } catch (modelError) {
      console.error(`XML generation model ${modelId} failed:`, modelError)
    }
  }

  if (extracted.length === 0) {
    return {
      textStream: stringToTextStream(text),
      research: input.research,
      designNote: input.designNote,
      writes: [],
      persistedByAgentRuntime: false,
      operation: input.mustApply ? 'mutation' : 'read_only',
    }
  }

  // No sandbox → refuse authoritative mutation (do not hand RAM writes to client/route)
  if (!input.sandbox) {
    console.error('[AgentRuntime] XML compatibility writes refused: no sandbox for persistMutation')
    input.onProgress?.('Could not persist file changes (sandbox unavailable).')
    return {
      textStream: stringToTextStream(text),
      research: input.research,
      designNote: input.designNote,
      writes: [],
      persistedByAgentRuntime: false,
      operation: input.mustApply ? 'mutation' : 'read_only',
    }
  }

  const sandbox = input.sandbox
  input.onProgress?.('Persisting compatibility file updates…')

  const { accepted, phase3Gate } = await withProjectMutationLock(input.projectId, async () => {
    const emitter = createRuntimeEmitter(input.planId, input.onAgentEvent)
    const persistMutation = createPersistMutationFn({
      projectId: input.projectId,
      planId: input.planId,
      sandbox,
      appendDurableHistory: input.appendDurableHistory,
      emitter,
      alreadyLocked: true,
    })

    const persisted = await acceptXmlCompatibilityWrites({
      writes: extracted,
      fileMap: input.fileMap,
      persistMutation,
      onTimeline: input.onTimeline
        ? (step) =>
            input.onTimeline?.({
              kind: step.kind,
              title: step.title,
              path: step.path,
              detail: step.detail,
              status: step.status,
            })
        : undefined,
    })

    if (persisted.length === 0) {
      return { accepted: persisted, phase3Gate: undefined as AgentRunGateResult | undefined }
    }

    // Preserve Phase 3 architecture after XML adapter persist (same lock / planId)
    const phase3 = await runPhase3InstallBuildRepair({
      projectId: input.projectId,
      planId: input.planId,
      sandbox,
      emitter,
      persistMutation,
      fileMap: input.fileMap,
      writtenPaths: persisted.map((w) => w.path),
      abortSignal: input.abortSignal,
      onProgress: input.onProgress,
    })

    return { accepted: persisted, phase3Gate: phase3.gate }
  })

  if (accepted.length === 0) {
    console.error('[AgentRuntime] XML compatibility writes failed to persist')
    return {
      textStream: stringToTextStream(text),
      research: input.research,
      designNote: input.designNote,
      writes: [],
      persistedByAgentRuntime: false,
      operation: input.mustApply ? 'mutation' : 'read_only',
    }
  }

  return {
    textStream: stringToTextStream(text),
    research: input.research,
    designNote: input.designNote,
    writes: accepted,
    // Writes were persisted; overall acceptance is phase3Gate.success (may be false).
    persistedByAgentRuntime: true,
    phase3Gate,
    operation: input.mustApply ? 'mutation' : 'read_only',
  }
}

/**
 * Streamed application response generation.
 * Refactored version: ensures thinking and plan data are transmitted in real time, and code data is transmitted completely.
 */
export async function streamGenerateApp(
  prompt: string,
  projectId: string,
  selectedItems: SelectedItem[] = [],
  imageData?: { data: ArrayBuffer; contentType: string } | null,
  abortSignal?: AbortSignal,
  selectedModelId?: string,
  onProgress?: (message: string) => void,
  onTimeline?: (step: {
    kind: 'thought' | 'check' | 'edit' | 'verify' | 'summary'
    title: string
    detail?: string
    path?: string
    durationMs?: number
    status?: 'running' | 'done' | 'failed'
    id?: string
  }) => void,
  planId?: string,
  onAgentEvent?: (event: AgentEvent) => void
) {
  return generateStreamResponse(
    prompt,
    projectId,
    selectedItems,
    imageData,
    abortSignal,
    {
      isFileEdit: false,
      quotaType: 'ai',
      modelId: selectedModelId || '',
    },
    onProgress,
    onTimeline,
    planId,
    onAgentEvent
  )
}

/**
 * Optimized file-focused application response generation for element editing.
 * This function follows the same structure as streamGenerateApp but processes only the target file.
 */
export async function streamGenerateAppForFileEdit(
  prompt: string,
  projectId: string,
  targetFilename: string,
  selectedItems: SelectedItem[] = [],
  imageData?: { data: ArrayBuffer; contentType: string } | null,
  abortSignal?: AbortSignal,
  onProgress?: (message: string) => void,
  onTimeline?: (step: {
    kind: 'thought' | 'check' | 'edit' | 'verify' | 'summary'
    title: string
    detail?: string
    path?: string
    durationMs?: number
    status?: 'running' | 'done' | 'failed'
    id?: string
  }) => void,
  planId?: string,
  onAgentEvent?: (event: AgentEvent) => void
) {
  return generateStreamResponse(
    prompt,
    projectId,
    selectedItems,
    imageData,
    abortSignal,
    {
      isFileEdit: true,
      targetFilename,
      quotaType: 'enhance',
    },
    onProgress,
    onTimeline,
    planId,
    onAgentEvent
  )
}
