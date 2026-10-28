import { stepCountIs, streamText } from 'ai'
import { selectCapabilities } from '../capabilities'
import { type CompletenessItem, writesCoverCompleteness } from '../design/completeness'
import type { ProductBlueprint } from '../design/product-blueprint'
import type { ModelGatewayClient } from '../model-gateway/client'
import { isModelServiceEnabled } from '../model-gateway/config'
import { startTrajectoryRecording } from '../model-gateway/recording'
import type { TrajectoryRecorder } from '../model-gateway/trajectory-recorder'
import { buildProviderOptions } from '../models'
import { failOverFromOpenAI, failoverNotice, maxRetriesFor, resolveModelId } from '../provider-failover'
import { GEMINI_FALLBACK_MODEL_NAME, isMuseConfigured, MUSE_MODEL_ID, myProvider } from '../providers'
import { acceptRuntimeWrites } from './accept-writes'
import {
  APPLY_RETRY_SUFFIX,
  COMPLETENESS_RETRY_SUFFIX,
  extractFilenames,
  extractWritesFromXml,
  hasFileActionXml,
  requiresApply,
  stringToTextStream,
} from './apply'
import {
  buildOrchestratedPasses,
  forcedUiPaths,
  isDependencyOnlyBuild,
} from './build-passes'
import { completeAgentRun, dedupeWrites } from './complete-run'
import { consumeAiSdkFullStream } from './consume-tool-stream'
import { isCursorAgentEnabled, runCursorBackendAgent } from './cursor-bridge'
import { normalizeFileMap } from './file-map'
import { createDefaultGatewayClient, runGatewayAgentBody } from './gateway-loop'
import { type ImageBudget, MAX_GENERATED_IMAGES } from './generate-image'
import { formatRecentChat } from './history'
import { filterWritesForAgent, openaiSystemForSwarm, planSwarmTasks } from './multi-agent'
import type { Phase3CommandRunner, Phase3RepairFn } from './phase3-pipeline'
import { getGuaranteedPreviewWrites } from './preview-fixes'
import type { PreviewHealthResult } from './preview-health'
import {
  describeProviderError,
  isProviderFatalError,
  ProviderFatalError,
  type ProviderErrorInfo,
} from './provider-errors'
import { withProjectMutationLock } from './project-mutation-lock'
import { formatRelevantFiles, pickRelevantFiles } from './relevant'
import { createRuntimeEmitter, type RuntimeEmitter } from './runtime-emitter'
import { type AllowlistedCommandSpec, executeAllowlistedCommand } from './sandbox-commands'
import {
  homeNeedsProductRewrite,
  TEMPLATE_HOME_PATH,
} from './starter-brand'
import { planTasksFromPrompt } from './tasks'
import { createAgentTools, createPersistMutationFn } from './tools'
import type { AgentWrite } from './xml'

const TOOL_SYSTEM = `You are QuickXBuild's in-product coding agent for THIS user's generated app.
Use tools on their file tree. Any project type is valid.
If <designSpec> is present, match layout, color, type, and spacing. Do not invent a different look.
If <completeness> is present, ship every listed path as a finished screen plus nav in src/App.tsx. No stubs, TODO, or lorem.
When UI needs a real photo or illustration (hero, product, empty-state art), call generate_image first, then write_file to import { src, alt } from that module. Never leave gray boxes, empty placeholders, or stock URL strings.
For implement/fix/add/change/build requests you MUST call write_file or apply_patch with complete file contents (after any generate_image calls).
Never edit QuickXBuild platform auth, billing, or repo .env secrets.`

const FULL_BUILD_SYSTEM = `You are QuickXBuild's in-product coding agent building THIS user's generated app from a product brief.
You MUST call write_file (or apply_patch) in this turn — multiple times if needed — with COMPLETE file contents.
Priority order (real developer workflow):
1) Backend/system first when <productBlueprint> asks for auth/forms (server/*, schema)
2) Design system: src/index.css tokens + Layout/Header/Footer with the brand name from <productBlueprint>
3) Assets: call generate_image for a logo when brandName is set; write src/assets/generated/logo.ts and wire into Header
4) src/App.tsx with routes + nav to every <completeness> path
5) src/pages/Index.tsx for Home at route "/" (the template mounts Index — NEVER leave QuickXBuild Ecommerce / Store / admin@admin.com / "Your app is ready" unless the user asked for ecommerce)
6) src/pages/* for each other listed screen (real layout, real copy, Tailwind, subtle animations)
7) SEO: index.html title/meta matching <productBlueprint>.seo
REPLACE the starter template branding entirely with the user's product.
Do not browse forever. Do not reply with only a plan or "Design locked".
A turn with zero write_file / apply_patch calls is a failure.
If Preview shows "Failed to resolve import", add the package to package.json and run bun install via a command action, then keep writing pages.
Never edit QuickXBuild platform auth, billing, or repo .env secrets.`

const SURGICAL_SYSTEM = `You are QuickXBuild's in-product coding agent fixing THIS user's generated app.
You MUST call write_file or apply_patch with the COMPLETE updated file contents.
Do not explain. Do not plan in prose. Do not rebuild unrelated pages.
Read the user request, change only the files needed, and write them via tools.
If the request includes a full product brief (e.g. travel agency website), treat it as a product build: rewrite src/pages/Index.tsx and src/App.tsx for that brand — do not only patch socket.ts.
Never edit QuickXBuild platform auth, billing, or repo .env secrets.`

const REPAIR_SYSTEM = `You are QuickXBuild's in-product coding agent repairing THIS user's generated app after a build failure.
You receive a normalized Vite/build diagnostic. Stay in the SAME repair session.
Use read_file to inspect the failing file, then write_file or apply_patch with COMPLETE fixed file contents.
You may call install_packages if a dependency is missing, or run_build to verify.
Do not invent a separate Fix AI. Do not reply with only prose.
Never edit QuickXBuild platform auth, billing, or repo .env secrets.`

const PAGE_WRITE_SYSTEM = `You are QuickXBuild's in-product coding agent.
Call write_file exactly once with the COMPLETE contents for the single target file named in the user message.
No prose. No other tools. No partial stubs.
For src/pages/Index.tsx: build the user's product home (brand, hero, CTAs) — never QuickXBuild Ecommerce or a blank starter.`

/** Visible narration shown in the user's Details timeline (not hidden reasoning). */
const NARRATION_HINT = `NARRATION: Before each group of tool calls, write one or two short plain sentences for the user saying what you are about to do and why (e.g. "Reading the About and Services pages to see the current layout." / "Now updating the Home hero and the services grid."). Never paste code in prose. Every write_file/apply_patch "description" must say what changed in that file in one sentence.`

/** Some OpenAI orgs must be verified before reasoning summaries are allowed. */
let reasoningSummaryEnabled = process.env.OPENAI_REASONING_SUMMARY !== '0'
let narrationSeq = 0

function narrationTitle(text: string): string {
  const firstLine = text.split('\n').find((line) => line.trim())?.trim() || text
  const sentence = firstLine.split(/(?<=[.!?])\s/)[0] || firstLine
  return sentence.length > 90 ? `${sentence.slice(0, 90)}…` : sentence
}

type LoopInput = {
  prompt: string
  xmlFiles: string
  knowledge?: string | null
  extraContext?: string
  messageHistory?: string | null
  fileMap: Record<string, { content?: string }>
  userPlan: string
  modelId?: string
  isFileEdit?: boolean
  abortSignal?: AbortSignal
  completeness?: CompletenessItem[]
  /** Phase 1 product blueprint — drives ordered full-build passes. */
  blueprint?: ProductBlueprint | null
  /** Plan id for Agent Runtime NDJSON (Phase 1). */
  planId?: string
  /** Project id for Phase 2 mutation lock + durable history. */
  projectId?: string
  /** Phase 2: sandbox filesystem (runtime source of truth). */
  sandbox?: import('./sandbox-fs').SandboxFilesystem
  /** Phase 2: append durable history after sandbox write. */
  appendDurableHistory?: (
    record: import('./persist-mutation').DurableMutationRecord
  ) => Promise<void>
  /** Phase 2: pre-built persist fn (tests). Prefer sandbox + appendDurableHistory in prod. */
  persistMutation?: import('./tools').PersistMutationFn
  /** Phase 3 test hooks — injectable command/preview/repair. */
  phase3RunCommand?: Phase3CommandRunner
  phase3CheckPreview?: (url?: string) => Promise<PreviewHealthResult>
  phase3RepairFn?: Phase3RepairFn
  phase3PreviewUrl?: string
  /** Live Agent Runtime events — forwarded by /api/ai while tools still run. */
  onAgentEvent?: (event: import('./runtime-events').AgentEvent) => void
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
  /**
   * ModelGateway client (QuickXBuild model service). Defaults to MODEL_SERVICE_URL when
   * QUICKXBUILD_MODEL_SERVICE_ENABLED is on; null forces the provider path.
   */
  modelGateway?: ModelGatewayClient | null
  /** Set internally when trajectory recording is active. */
  trajectoryRecorder?: TrajectoryRecorder
}

export type AgentLoopResult = {
  textStream: ReadableStream<string>
  applied: boolean
  writes: AgentWrite[]
  /** Phase 3 gate result when install/build/preview ran. */
  phase3Gate?: import('./runtime-gate').AgentRunGateResult
  /** Set when the model provider refused the account (no credits, bad key). Do not retry. */
  providerError?: { code?: string; message: string }
  /** Resolves to the stored trajectory id (or null) when recording is enabled. */
  trajectorySubmission?: Promise<string | null>
}

export async function runAgentLoop(input: LoopInput): Promise<AgentLoopResult> {
  const recording = startTrajectoryRecording({
    projectId: input.projectId,
    planId: input.planId,
    prompt: input.prompt,
    fileMap: normalizeFileMap(input.fileMap),
    modelId: input.modelId,
    onAgentEvent: input.onAgentEvent,
  })
  if (!recording) return runAgentLoopLocked(input)

  const result = await runAgentLoopLocked({
    ...input,
    onAgentEvent: recording.onAgentEvent,
    trajectoryRecorder: recording.recorder,
  })
  // Submitted after the project lock is released; never blocks or fails the request.
  result.trajectorySubmission = recording.submit({
    applied: result.applied,
    writes: result.writes,
    gate: result.phase3Gate,
    error: result.providerError?.message,
  })
  return result
}

async function runAgentLoopLocked(input: LoopInput): Promise<AgentLoopResult> {
  const mustApply = requiresApply(input.prompt, input.isFileEdit)
  try {
    // Hold project lock across write → install → build → repair → preview (Phase 3).
    if (mustApply && input.projectId) {
      return await withProjectMutationLock(input.projectId, () => runAgentLoopBody(input, true))
    }
    return await runAgentLoopBody(input, false)
  } catch (error) {
    if (!isProviderFatalError(error)) throw error
    const message = error.userMessage
    console.error(`Agent provider refused request (${error.modelId}): ${error.code ?? ''} ${error.message}`)
    input.onProgress?.(message)
    input.onTimeline?.({
      id: 'provider-error',
      kind: 'verify',
      title: 'AI provider unavailable',
      detail: message,
      status: 'failed',
    })
    createRuntimeEmitter(input.planId || 'pending', input.onAgentEvent).agentError(message)
    return {
      textStream: stringToTextStream(message),
      applied: false,
      writes: [],
      providerError: { code: error.code, message },
    }
  }
}

async function runAgentLoopBody(
  input: LoopInput,
  alreadyLocked: boolean
): Promise<AgentLoopResult> {
  const mustApply = requiresApply(input.prompt, input.isFileEdit)
  const fileMap = normalizeFileMap(input.fileMap)
  const recentChat = formatRecentChat(input.messageHistory)
  const relevant = pickRelevantFiles(fileMap, input.prompt)
  const work = planTasksFromPrompt(input.prompt).filter((task) => task.agent !== 'planner')
  const completeness = input.completeness || []
  const completenessXml = completeness.length
    ? `<completeness>${completeness.map((item) => `${item.path} — ${item.title}`).join('\n')}</completeness>`
    : ''
  const capabilities = selectCapabilities(input.userPlan, input.modelId, input.isFileEdit)
  // Prefer fast (mini) for tools — large reasoning models often return prose instead of write_file.
  const toolModels = [...new Set([capabilities.fast, capabilities.code])]
  const writerModels = [...new Set([capabilities.fast, capabilities.code])]
  const xmlModels = [...new Set([capabilities.fast, capabilities.code])]
  const isSurgical = completeness.length === 0
  const isFullBuild = completeness.length > 0
  const blueprint = input.blueprint || null
  const cursorEnabled = isCursorAgentEnabled()
  const swarm = planSwarmTasks(input.prompt, { cursorEnabled })
  const cursorTask = swarm.find(
    (task) =>
      (task.agent === 'cursor-backend' || task.agent === 'cursor-debug') &&
      task.status !== 'skipped'
  )
  // Full builds: write-first (models burn steps on list/read and return zero files).
  // When Cursor owns backend, OpenAI stays strictly on frontend to cut confusion.
  const primarySystem = cursorEnabled
    ? `${openaiSystemForSwarm()}\n${isFullBuild ? FULL_BUILD_SYSTEM : SURGICAL_SYSTEM}`
    : isFullBuild
      ? FULL_BUILD_SYSTEM
      : isSurgical
        ? SURGICAL_SYSTEM
        : TOOL_SYSTEM
  const primaryWriteOnly = isSurgical || isFullBuild

  const emitPlanItem = (itemId: string, status: 'pending' | 'running' | 'done' | 'failed') => {
    if (!input.planId || !input.onAgentEvent) return
    input.onAgentEvent({
      type: 'build_plan',
      version: 1,
      planId: input.planId,
      data: {
        brandName: blueprint?.brandName,
        vertical: blueprint?.vertical,
        items: [{ id: itemId, label: itemId, status }],
      },
    })
  }

  const user = [
    formatRelevantFiles(fileMap, relevant),
    input.knowledge ? `<projectKnowledge>\n${input.knowledge}\n</projectKnowledge>` : '',
    input.extraContext || '',
    recentChat,
    work.length > 0
      ? `<tasks>${work.map((task) => `${task.agent}: ${task.title}`).join(' | ')}</tasks>`
      : '',
    cursorEnabled
      ? `<swarm>OpenAI=frontend (src/*). Cursor=backend (server/*, auth, db, package.json). Do not steal each other's files.</swarm>`
      : '',
    completenessXml,
    `<userRequest>${input.prompt}</userRequest>`,
  ]
    .filter(Boolean)
    .join('\n\n')

  let lastText = ''
  const allWrites: AgentWrite[] = []
  const imageBudget: ImageBudget = { count: 0, max: MAX_GENERATED_IMAGES }
  const onProgress = input.onProgress
  const onTimeline = input.onTimeline
  const emitter = createRuntimeEmitter(input.planId || 'pending', input.onAgentEvent)
  const thoughtStarted = Date.now()
  const requestGist = input.prompt.replace(/\s+/g, ' ').trim()
  const openingTitle = requestGist
    ? `Reading your request: ${requestGist.length > 60 ? `${requestGist.slice(0, 60)}…` : requestGist}`
    : 'Understanding your request'

  const persistMutation =
    input.persistMutation ||
    (input.sandbox && input.projectId && input.appendDurableHistory
      ? createPersistMutationFn({
          projectId: input.projectId,
          planId: input.planId || 'pending',
          sandbox: input.sandbox,
          appendDurableHistory: input.appendDurableHistory,
          emitter,
          alreadyLocked,
        })
      : undefined)

  // Phase 1/2: live Agent Runtime lifecycle; file_write emitted only after sandbox persist
  emitter.agentStart(mustApply ? 'mutation' : 'read_only')
  emitter.stepStart('plan', 'Planning changes')

  const modelGateway =
    input.modelGateway === undefined
      ? isModelServiceEnabled()
        ? createDefaultGatewayClient()
        : null
      : input.modelGateway
  if (modelGateway) {
    const outcome = await runGatewayAgentBody({
      input,
      client: modelGateway,
      emitter,
      persistMutation,
      fileMap,
      mustApply,
      recorder: input.trajectoryRecorder,
    })
    if (outcome.kind === 'completed') return outcome.result
    onProgress?.('QuickXBuild model service unavailable — using the standard AI provider.')
  }

  onProgress?.('Planning changes for your project…')
  onTimeline?.({
    id: 'thought-plan',
    kind: 'thought',
    title: cursorEnabled
      ? 'Assigning OpenAI (UI) + Cursor (backend) agents'
      : openingTitle,
    detail: cursorEnabled
      ? 'Splitting frontend to OpenAI and server/auth/db to Cursor to reduce token waste and confusion.'
      : 'I am reading your project and planning the exact files to change.',
    status: 'running',
  })
  onTimeline?.({
    kind: 'check',
    title: 'Checking your project files',
    status: 'running',
    id: 'check-files',
  })
  emitter.stepStart('check', 'Checking project files')

  // Parallel swarm: Cursor backend + OpenAI frontend (when Cursor key is present).
  const cursorPromise = cursorTask
    ? runCursorBackendAgent({
        prompt: cursorTask.prompt,
        fileMap,
        abortSignal: input.abortSignal,
        onProgress: (message) => {
          onProgress?.(message)
          onTimeline?.({
            kind: 'check',
            title: 'Cursor backend agent',
            detail: message,
            status: 'running',
            id: 'cursor-backend',
          })
        },
      })
    : Promise.resolve(null)

  {
    const planLines = [
      blueprint
        ? `Building ${blueprint.brandName}${blueprint.vertical ? ` (${blueprint.vertical})` : ''}.`
        : '',
      isFullBuild && blueprint
        ? `Order: ${buildOrchestratedPasses(blueprint)
            .map((pass) => pass.title)
            .join(' → ')}.`
        : '',
      completeness.length > 0
        ? `Screens to ship: ${completeness
            .slice(0, 10)
            .map((item) => item.title)
            .join(', ')}.`
        : '',
      work.length > 0 ? `Tasks: ${work.map((task) => task.title).join('; ')}.` : '',
      cursorEnabled ? 'Backend (server, auth, db) goes to the Cursor agent; UI stays here.' : '',
    ].filter(Boolean)
    onTimeline?.({
      id: 'thought-plan',
      kind: 'thought',
      title: openingTitle,
      detail: planLines.join('\n') || 'Mapped your request to the files that need to change.',
      durationMs: Date.now() - thoughtStarted,
      status: 'done',
    })
  }

  for (const modelId of toolModels) {
    if (isFullBuild && blueprint) {
      const passes = buildOrchestratedPasses(blueprint)
      // Backend pass first when Cursor owns it — otherwise OpenAI runs backend pass.
      if (!cursorEnabled) {
        const backendPass = passes.find((p) => p.id === 'backend')
        if (backendPass) {
          emitPlanItem(backendPass.planItemId, 'running')
          onProgress?.(backendPass.title)
          onTimeline?.({
            kind: 'check',
            title: backendPass.title,
            status: 'running',
            id: `pass-${backendPass.id}`,
          })
          const { text, writes } = await runToolPass({
            modelId,
            system: `${primarySystem}\nPASS: ${backendPass.systemHint}`,
            prompt: `${user}\n\n<buildPass id="${backendPass.id}">${backendPass.userHint}\nFocus paths: ${backendPass.focusPaths.join(', ')}</buildPass>`,
            fileMap,
            mustApply,
            abortSignal: input.abortSignal,
            userPlan: input.userPlan,
            selectedModelId: input.modelId,
            imageBudget,
            onProgress,
            onTimeline,
            emitter,
            persistMutation,
            writeOnly: true,
            maxSteps: backendPass.maxSteps,
            sandboxRoot: input.sandbox?.root,
            phase3RunCommand: input.phase3RunCommand,
            enablePhase3Commands: Boolean(input.sandbox),
          })
          lastText = text || lastText
          allWrites.push(...writes)
          const extracted = extractWritesFromXml(text)
          if (extracted.length > 0) {
            const accepted = await acceptRuntimeWrites({
              writes: extracted,
              fileMap,
              persistMutation,
              source: 'xml',
              onTimeline,
            })
            allWrites.push(...accepted)
          }
          emitPlanItem(backendPass.planItemId, 'done')
          onTimeline?.({
            kind: 'check',
            title: backendPass.title,
            status: 'done',
            id: `pass-${backendPass.id}`,
          })
        }
      }

      const frontendPasses = passes.filter((p) => p.id !== 'backend')
      for (const pass of frontendPasses) {
        if (input.abortSignal?.aborted) break
        emitPlanItem(pass.planItemId, 'running')
        onProgress?.(pass.title)
        onTimeline?.({
          kind: 'check',
          title: pass.title,
          detail: pass.focusPaths.slice(0, 4).join(', '),
          status: 'running',
          id: `pass-${pass.id}`,
        })
        const { text, writes, error: passError } = await runToolPass({
          modelId,
          system: `${primarySystem}\nPASS: ${pass.systemHint}`,
          prompt: `${user}\n\n<buildPass id="${pass.id}">${pass.userHint}\nFocus paths: ${pass.focusPaths.join(', ')}</buildPass>`,
          fileMap,
          mustApply,
          abortSignal: input.abortSignal,
          userPlan: input.userPlan,
          selectedModelId: input.modelId,
          imageBudget,
          onProgress,
          onTimeline,
          emitter,
          persistMutation,
          writeOnly: true,
          maxSteps: pass.maxSteps,
          sandboxRoot: input.sandbox?.root,
          phase3RunCommand: input.phase3RunCommand,
          enablePhase3Commands: Boolean(input.sandbox),
        })
        lastText = text || lastText
        const scopedWrites = cursorEnabled ? filterWritesForAgent(writes, 'openai-frontend') : writes
        allWrites.push(...scopedWrites)
        const extracted = extractWritesFromXml(text)
        const scopedExtracted = cursorEnabled
          ? filterWritesForAgent(extracted, 'openai-frontend')
          : extracted
        if (scopedExtracted.length > 0) {
          const accepted = await acceptRuntimeWrites({
            writes: scopedExtracted,
            fileMap,
            persistMutation,
            source: 'xml',
            onTimeline,
          })
          allWrites.push(...accepted)
        }
        const passWrote = scopedWrites.length + scopedExtracted.length
        emitPlanItem(pass.planItemId, passWrote > 0 ? 'done' : 'failed')
        onTimeline?.({
          kind: 'check',
          title: passWrote > 0 ? `${pass.title} · ${passWrote} file${passWrote === 1 ? '' : 's'}` : pass.title,
          detail:
            passWrote > 0
              ? undefined
              : passError
                ? `No files written: ${passError}`
                : 'No files written in this pass.',
          status: passWrote > 0 ? 'done' : 'failed',
          id: `pass-${pass.id}`,
        })
      }
      console.info(
        `Agent orchestrated passes ${modelId}: writes=${allWrites.length} passes=${passes.length}`
      )
      if (allWrites.length > 0) {
        break
      }
      // Fall through to single-shot if orchestrated produced nothing
    }

    onProgress?.(
      isFullBuild
        ? cursorEnabled
          ? 'OpenAI writing frontend pages…'
          : 'Building your pages and writing files…'
        : 'Reading your project and applying edits…'
    )
    const { text, writes } = await runToolPass({
      modelId,
      system: primarySystem,
      prompt: user,
      fileMap,
      mustApply,
      abortSignal: input.abortSignal,
      userPlan: input.userPlan,
      selectedModelId: input.modelId,
      imageBudget,
      onProgress,
      onTimeline,
      emitter,
      persistMutation,
      writeOnly: primaryWriteOnly,
      maxSteps: isFullBuild ? 12 : undefined,
      sandboxRoot: input.sandbox?.root,
      phase3RunCommand: input.phase3RunCommand,
      enablePhase3Commands: Boolean(input.sandbox),
    })
    lastText = text || lastText
    const scopedWrites = cursorEnabled ? filterWritesForAgent(writes, 'openai-frontend') : writes
    allWrites.push(...scopedWrites)
    const extracted = extractWritesFromXml(text)
    const scopedExtracted = cursorEnabled
      ? filterWritesForAgent(extracted, 'openai-frontend')
      : extracted
    if (scopedExtracted.length > 0) {
      const accepted = await acceptRuntimeWrites({
        writes: scopedExtracted,
        fileMap,
        persistMutation,
        source: 'xml',
        onTimeline,
      })
      allWrites.push(...accepted)
    }
    console.info(
      `Agent tool pass ${modelId}: writes=${writes.length} scoped=${scopedWrites.length} extracted=${extracted.length} text=${text.length}`
    )
    if (allWrites.length > 0) {
      break
    }
  }

  const cursorResult = await cursorPromise
  if (cursorResult?.writes.length) {
    const cursorWrites = filterWritesForAgent(cursorResult.writes, 'cursor-backend')
    const accepted = await acceptRuntimeWrites({
      writes: cursorWrites,
      fileMap,
      persistMutation,
      source: 'cursor',
      onTimeline,
    })
    allWrites.push(...accepted)
    if (cursorResult.report) {
      lastText = `${lastText}\n\n<cursorReport>${cursorResult.report.slice(0, 4000)}</cursorReport>`
    }
    onTimeline?.({
      id: 'cursor-backend',
      kind: 'check',
      title: `Cursor backend done (${accepted.length} files)`,
      detail: cursorResult.report?.slice(0, 240),
      status: accepted.length > 0 ? 'done' : 'failed',
    })
  } else if (cursorTask) {
    onTimeline?.({
      id: 'cursor-backend',
      kind: 'check',
      title: 'Cursor backend finished',
      detail: cursorResult?.error || 'No backend diffs (OpenAI may cover if needed)',
      status: cursorResult?.ok ? 'done' : 'failed',
    })
  }

  onTimeline?.({
    id: 'check-files',
    kind: 'check',
    title: 'Checked project files',
    status: 'done',
  })

  if (mustApply && completeness.length > 0 && allWrites.length > 0) {
    const cover = writesCoverCompleteness(
      [
        ...allWrites.map((write) => write.path),
        ...(hasFileActionXml(lastText) ? extractFilenames(lastText) : []),
      ],
      completeness
    )
    if (!cover.ok) {
      onProgress?.(`Filling missing screens: ${cover.missing.slice(0, 3).join(', ')}…`)
      const retryPrompt = `${user}${COMPLETENESS_RETRY_SUFFIX(cover.missing)}`
      for (const modelId of writerModels) {
        const { text, writes } = await runToolPass({
          modelId,
          system: TOOL_SYSTEM,
          prompt: retryPrompt,
          fileMap,
          mustApply: true,
          abortSignal: input.abortSignal,
          userPlan: input.userPlan,
          selectedModelId: input.modelId,
          imageBudget,
          onProgress,
          onTimeline,
          emitter,
          persistMutation,
          writeOnly: false,
          sandboxRoot: input.sandbox?.root,
          phase3RunCommand: input.phase3RunCommand,
          enablePhase3Commands: Boolean(input.sandbox),
        })
        lastText = text || lastText
        allWrites.push(...writes)
        const extractedRetry = extractWritesFromXml(text)
        const acceptedRetry = await acceptRuntimeWrites({
          writes: extractedRetry,
          fileMap,
          persistMutation,
          source: 'xml',
          onTimeline,
        })
        allWrites.push(...acceptedRetry)
        const again = writesCoverCompleteness(
          allWrites.map((write) => write.path),
          completeness
        )
        if (again.ok || writes.length + acceptedRetry.length > 0) {
          break
        }
      }
    }
  }

  if (mustApply && allWrites.length === 0) {
    onProgress?.('Retrying with a full file write…')
    onTimeline?.({
      kind: 'check',
      title: 'Retrying file writes',
      detail: 'Previous pass did not change files. Trying a direct write pass.',
      status: 'running',
      id: 'retry-write',
    })
    for (const modelId of xmlModels) {
      const text = await runXmlWritePass({
        modelId,
        prompt: `${user}${APPLY_RETRY_SUFFIX}`,
        abortSignal: input.abortSignal,
      })
      lastText = text || lastText
      const extracted = extractWritesFromXml(text)
      const accepted = await acceptRuntimeWrites({
        writes: extracted,
        fileMap,
        persistMutation,
        source: 'xml',
        onTimeline,
      })
      allWrites.push(...accepted)
      console.info(
        `Agent XML write pass ${modelId}: text=${text.length} extracted=${extracted.length} accepted=${accepted.length} hasFiles=${hasFileActionXml(text)}`
      )
      if (allWrites.length > 0) {
        break
      }
    }
    onTimeline?.({
      id: 'retry-write',
      kind: 'check',
      title: allWrites.length > 0 ? 'Retry write succeeded' : 'Retry write finished',
      status: allWrites.length > 0 ? 'done' : 'failed',
    })
  }

  // Last resort for full builds: force one write_file per screen so the IDE never gets zero files.
  if (mustApply && allWrites.length === 0 && completeness.length > 0) {
    onProgress?.('Writing pages one by one…')
    onTimeline?.({
      id: 'page-writes',
      kind: 'check',
      title: 'Writing each page',
      detail: 'Forcing file writes for every required screen.',
      status: 'running',
    })
    const pageTargets = buildPageWriteTargets(completeness)
    for (const target of pageTargets) {
      if (input.abortSignal?.aborted) {
        break
      }
      onProgress?.(`Writing ${target.path}…`)
      onTimeline?.({
        id: 'page-writes',
        kind: 'edit',
        title: `Writing ${target.path}`,
        path: target.path,
        detail: target.title,
        status: 'running',
      })
      const modelId = writerModels[0]
      if (!modelId) {
        break
      }
      const existing = fileMap[target.path]?.content || fileMap[`./${target.path}`]?.content || ''
      const pagePrompt = `${user}

TARGET FILE (write ONLY this path via write_file): ${target.path}
Screen: ${target.title}
Route: ${target.route}
Existing file preview (may be empty):
\`\`\`
${existing.slice(0, 2500)}
\`\`\`
Call write_file now with the complete ${target.path} contents, following the user's brief (their copy, colors, and sections) exactly.`
      const { text, writes } = await runToolPass({
        modelId,
        system: PAGE_WRITE_SYSTEM,
        prompt: pagePrompt,
        fileMap,
        mustApply: true,
        abortSignal: input.abortSignal,
        userPlan: input.userPlan,
        selectedModelId: input.modelId,
        imageBudget,
        onProgress,
        onTimeline,
        emitter,
        persistMutation,
        writeOnly: true,
        maxSteps: 3,
        forceTool: 'write_file',
        sandboxRoot: input.sandbox?.root,
        phase3RunCommand: input.phase3RunCommand,
        enablePhase3Commands: Boolean(input.sandbox),
      })
      lastText = text || lastText
      allWrites.push(...writes)
      const extracted = extractWritesFromXml(text).filter(
        (write) => write.path.replace(/^\.\//, '') === target.path
      )
      const accepted = await acceptRuntimeWrites({
        writes: extracted,
        fileMap,
        persistMutation,
        source: 'xml',
        onTimeline,
      })
      allWrites.push(...accepted)
      if (writes.length + accepted.length > 0) {
        // Keep going through remaining pages — do not break early.
      }
    }
    onTimeline?.({
      id: 'page-writes',
      kind: 'check',
      title:
        allWrites.length > 0
          ? `Wrote ${dedupeWrites(allWrites).length} page file(s)`
          : 'Page write pass finished',
      status: allWrites.length > 0 ? 'done' : 'failed',
    })
  }

  // Preview mounts src/pages/Index.tsx at "/". Writing only Home.tsx leaves the starter live.
  if (
    mustApply &&
    isFullBuild &&
    homeNeedsProductRewrite(input.prompt, fileMap, allWrites) &&
    !input.abortSignal?.aborted
  ) {
    onProgress?.(`Rewriting ${TEMPLATE_HOME_PATH} for your product…`)
    onTimeline?.({
      id: 'home-brand',
      kind: 'edit',
      title: `Writing ${TEMPLATE_HOME_PATH}`,
      path: TEMPLATE_HOME_PATH,
      detail: 'Replace starter/ecommerce home with the product brief.',
      status: 'running',
    })
    const modelId = writerModels[0]
    if (modelId) {
      const existing =
        fileMap[TEMPLATE_HOME_PATH]?.content || fileMap[`./${TEMPLATE_HOME_PATH}`]?.content || ''
      const pagePrompt = `${user}

TARGET FILE (write ONLY this path via write_file): ${TEMPLATE_HOME_PATH}
This file is the live Home at route "/". Replace ANY starter/ecommerce branding with the user's product from <userRequest>.
Existing file preview:
\`\`\`
${existing.slice(0, 2500)}
\`\`\`
Call write_file now with the complete ${TEMPLATE_HOME_PATH} for this product.`
      const { text, writes } = await runToolPass({
        modelId,
        system: PAGE_WRITE_SYSTEM,
        prompt: pagePrompt,
        fileMap,
        mustApply: true,
        abortSignal: input.abortSignal,
        userPlan: input.userPlan,
        selectedModelId: input.modelId,
        imageBudget,
        onProgress,
        onTimeline,
        emitter,
        persistMutation,
        writeOnly: true,
        maxSteps: 3,
        forceTool: 'write_file',
        sandboxRoot: input.sandbox?.root,
        phase3RunCommand: input.phase3RunCommand,
        enablePhase3Commands: Boolean(input.sandbox),
      })
      lastText = text || lastText
      allWrites.push(...writes)
      const extracted = extractWritesFromXml(text).filter(
        (write) => write.path.replace(/^\.\//, '') === TEMPLATE_HOME_PATH
      )
      const accepted = await acceptRuntimeWrites({
        writes: extracted,
        fileMap,
        persistMutation,
        source: 'xml',
        onTimeline,
      })
      allWrites.push(...accepted)
    }
    onTimeline?.({
      id: 'home-brand',
      kind: 'edit',
      title: `Updated ${TEMPLATE_HOME_PATH}`,
      path: TEMPLATE_HOME_PATH,
      status: 'done',
    })
  }

  // Always neutralize Preview killers (even when other writes succeeded).
  {
    const guaranteed = getGuaranteedPreviewWrites(fileMap, input.prompt)
    if (guaranteed.length > 0) {
      const existingPaths = new Set(allWrites.map((w) => w.path.replace(/^\.\//, '')))
      const pending = guaranteed.filter(
        (write) => !existingPaths.has(write.path.replace(/^\.\//, ''))
      )
      const accepted = await acceptRuntimeWrites({
        writes: pending,
        fileMap,
        persistMutation,
        source: 'guaranteed',
        onTimeline,
      })
      allWrites.push(...accepted)
    }
  }

  // Fail closed: full builds that only touched deps/server must still ship Index + App + CSS.
  if (
    mustApply &&
    isFullBuild &&
    blueprint &&
    isDependencyOnlyBuild(allWrites.map((w) => w.path))
  ) {
    onProgress?.('Forcing UI shell (Index, App, CSS)…')
    onTimeline?.({
      id: 'forced-ui',
      kind: 'edit',
      title: 'Writing required UI shell files',
      detail: forcedUiPaths().join(', '),
      status: 'running',
    })
    const modelId = writerModels[0]
    if (modelId) {
      const forcedPrompt = `${user}

REQUIRED: call write_file for EACH of: ${forcedUiPaths().join(', ')}.
Brand: ${blueprint.brandName}. Vertical: ${blueprint.vertical}.
Replace starter/ecommerce. Real Tailwind + SEO title in index.html.`
      const { text, writes } = await runToolPass({
        modelId,
        system: FULL_BUILD_SYSTEM,
        prompt: forcedPrompt,
        fileMap,
        mustApply: true,
        abortSignal: input.abortSignal,
        userPlan: input.userPlan,
        selectedModelId: input.modelId,
        imageBudget,
        onProgress,
        onTimeline,
        emitter,
        persistMutation,
        writeOnly: true,
        maxSteps: 8,
        sandboxRoot: input.sandbox?.root,
        phase3RunCommand: input.phase3RunCommand,
        enablePhase3Commands: Boolean(input.sandbox),
      })
      lastText = text || lastText
      allWrites.push(...writes)
      const extracted = extractWritesFromXml(text)
      const accepted = await acceptRuntimeWrites({
        writes: extracted,
        fileMap,
        persistMutation,
        source: 'xml',
        onTimeline,
      })
      allWrites.push(...accepted)
    }
    onTimeline?.({
      id: 'forced-ui',
      kind: 'edit',
      title: 'UI shell pass finished',
      status: 'done',
    })
  }

  return completeAgentRun({
    input,
    emitter,
    persistMutation,
    fileMap,
    allWrites,
    lastText,
    mustApply,
    // Primary: feed diagnostic back into SAME AgentRuntime (streamText + tools + same planId).
    // Test inject phase3RepairFn is wrapped as runtime repair that still goes through persistMutation.
    repairWithRuntime: async ({ diagnostic, attempt }) => {
      if (input.phase3RepairFn) {
        const writes = await input.phase3RepairFn({
          diagnostic,
          fileMap,
          attempt,
        })
        return { writes, alreadyPersisted: false }
      }

      const repairPrompt = [
        'BUILD FAILED — continue this SAME AgentRuntime repair session.',
        `planId=${input.planId || 'pending'} attempt=${attempt}`,
        '',
        '<diagnostic>',
        JSON.stringify(diagnostic, null, 2),
        '</diagnostic>',
        '',
        'Use tools now: read_file if needed, then write_file/apply_patch and/or install_packages.',
        'Fix the root cause. Do not respond with prose only.',
      ].join('\n')

      const modelId = toolModels[0] || capabilities.fast
      const { writes: repairWrites } = await runToolPass({
        modelId,
        system: REPAIR_SYSTEM,
        prompt: repairPrompt,
        fileMap,
        mustApply: true,
        abortSignal: input.abortSignal,
        userPlan: input.userPlan,
        selectedModelId: input.modelId,
        imageBudget,
        onProgress,
        onTimeline,
        emitter,
        persistMutation,
        writeOnly: false,
        maxSteps: 8,
        sandboxRoot: input.sandbox!.root,
        phase3RunCommand: input.phase3RunCommand,
        enablePhase3Commands: true,
      })
      return { writes: repairWrites, alreadyPersisted: true }
    },
  })
}

export function shouldUseAgentLoop(): boolean {
  return process.env.AGENT_TOOL_LOOP !== '0'
}

async function runToolPass(input: {
  modelId: string
  system: string
  prompt: string
  fileMap: Record<string, { content?: string }>
  mustApply: boolean
  abortSignal?: AbortSignal
  userPlan: string
  selectedModelId?: string
  imageBudget: ImageBudget
  writeOnly?: boolean
  maxSteps?: number
  forceTool?: 'write_file' | 'apply_patch'
  emitter?: RuntimeEmitter
  persistMutation?: import('./tools').PersistMutationFn
  /** Sandbox root for Phase 3 allowlisted commands. */
  sandboxRoot?: string
  phase3RunCommand?: Phase3CommandRunner
  /** When true, include install_packages / execute_command / run_build in streamText tools. */
  enablePhase3Commands?: boolean
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
}): Promise<{ text: string; writes: AgentWrite[]; error?: string }> {
  const writes: AgentWrite[] = []
  const defaultSteps = input.writeOnly ? 6 : 8
  const stepBudget = input.maxSteps ?? defaultSteps
  const emitter = input.emitter || createRuntimeEmitter('pending', undefined)

  const sandboxRoot = input.sandboxRoot
  const runSandboxCommand =
    input.enablePhase3Commands && sandboxRoot
      ? async (spec: AllowlistedCommandSpec) => {
          const runner = input.phase3RunCommand || executeAllowlistedCommand
          return runner(sandboxRoot, spec)
        }
      : undefined

  let lastError: string | undefined
  const run = async (
    toolChoice: 'auto' | 'required' | { type: 'tool'; toolName: 'write_file' | 'apply_patch' },
    maxSteps: number,
    prompt: string,
    writeOnly = Boolean(input.writeOnly)
  ): Promise<string> => {
    const created = createAgentTools(input.fileMap, {
      userPlan: input.userPlan,
      modelId: input.selectedModelId,
      abortSignal: input.abortSignal,
      imageBudget: input.imageBudget,
      onProgress: input.onProgress,
      onTimeline: input.onTimeline,
      writeOnly,
      persistMutation: input.persistMutation,
      emitter,
      // Phase 3: wire allowlisted command tools into the SAME streamText tool set
      runSandboxCommand: writeOnly ? undefined : runSandboxCommand,
    })
    const usedModelId = resolveModelId(input.modelId)
    // Meta Muse Spark only accepts tool_choice "auto" (not required / named tools).
    const museSafe =
      usedModelId === MUSE_MODEL_ID || isMuseConfigured()
    const effectiveToolChoice = museSafe ? ('auto' as const) : toolChoice
    const effectivePrompt =
      museSafe && toolChoice !== 'auto'
        ? `${prompt}

CRITICAL: You must call the available tools in this turn (prefer write_file / apply_patch). Do not reply with prose only.`
        : prompt
    const failOver = (info: ProviderErrorInfo): boolean => {
      if (!failOverFromOpenAI(usedModelId, info)) return false
      const notice = failoverNotice(info)
      input.onProgress?.(notice)
      input.onTimeline?.({
        id: 'provider-failover',
        kind: 'check',
        title: `Switched to ${GEMINI_FALLBACK_MODEL_NAME}`,
        detail: notice,
        status: 'done',
      })
      return true
    }
    try {
      const withSummary = reasoningSummaryEnabled
      const result = streamText({
        model: myProvider.languageModel(usedModelId),
        maxRetries: maxRetriesFor(usedModelId),
        system: `${input.system}\n${NARRATION_HINT}`,
        prompt: effectivePrompt,
        tools: created.tools,
        toolChoice: effectiveToolChoice,
        stopWhen: stepCountIs(maxSteps),
        ...(input.abortSignal && { abortSignal: input.abortSignal }),
        providerOptions: buildProviderOptions({ reasoningSummary: withSummary }),
      })

      // Phase 1: consume fullStream incrementally — emit tool events BEFORE generation ends.
      // Do not await result.text first (that was the blocking dump architecture).
      const consumed = await consumeAiSdkFullStream({
        fullStream: result.fullStream as AsyncIterable<{
          type: string
          toolName?: string
          toolCallId?: string
          input?: unknown
          args?: unknown
          output?: unknown
          error?: unknown
          text?: string
          id?: string
        }>,
        emitter,
        abortSignal: input.abortSignal,
        onNarration: (narration) => {
          input.onTimeline?.({
            id: `narration-${++narrationSeq}`,
            kind: 'thought',
            title: narration.kind === 'reasoning' ? 'Thinking' : narrationTitle(narration.text),
            detail: narration.text,
            durationMs: narration.durationMs,
            status: 'done',
          })
        },
      })

      if (consumed.aborted) {
        writes.push(...created.writes)
        return consumed.text
      }
      if (consumed.streamError) {
        console.error(`Agent stream error ${usedModelId}: ${consumed.streamError}`)
        lastError = consumed.streamError
        if (consumed.streamErrorInfo?.fatal) {
          if (created.writes.length === 0 && failOver(consumed.streamErrorInfo)) {
            return run(toolChoice, maxSteps, prompt, writeOnly)
          }
          throw new ProviderFatalError(usedModelId, consumed.streamErrorInfo)
        }
        if (withSummary && /reasoning summar|organization must be verified/i.test(consumed.streamError)) {
          reasoningSummaryEnabled = false
          return run(toolChoice, maxSteps, prompt, writeOnly)
        }
      }

      // Backup harvest after stream settles (tools already mutated created.writes during execute)
      let modelSteps: unknown[] = []
      try {
        modelSteps = await result.steps
      } catch {
        modelSteps = []
      }
      collectWritesFromSteps(modelSteps, created.writes)
      try {
        const toolCalls = await result.toolCalls
        collectWritesFromCalls(toolCalls, created.writes)
      } catch {
        // Some providers only expose tool calls through result.steps.
      }
      writes.push(...created.writes)
      return consumed.text
    } catch (error) {
      if (isProviderFatalError(error)) throw error
      const info = describeProviderError(error)
      if (info.fatal) {
        if (failOver(info)) return run(toolChoice, maxSteps, prompt, writeOnly)
        throw new ProviderFatalError(usedModelId, info)
      }
      console.error(`Agent model ${usedModelId} failed: ${info.message}`)
      lastError = info.message
      return ''
    }
  }

  // Prefer write tools; if the model only returns XML text, keep going to forced apply_patch.
  const initialToolChoice = input.forceTool
    ? ({ type: 'tool', toolName: input.forceTool } as const)
    : input.mustApply
      ? ('required' as const)
      : ('auto' as const)
  let text = await run(initialToolChoice, stepBudget, input.prompt, input.writeOnly)
  if (input.mustApply && writes.length === 0) {
    const extracted = extractWritesFromXml(text)
    if (extracted.length === 0) {
      const toolRetry = `${input.prompt}

CRITICAL EXECUTION REQUIREMENT: Do not answer with prose, analysis, or a plan. In this turn you must call the write_file tool now with a complete file replacement. The request is invalid unless the tool call executes.`
      text =
        (await run(
          { type: 'tool', toolName: 'write_file' },
          Math.min(4, stepBudget),
          toolRetry,
          true
        )) || text
    } else {
      const accepted = await acceptRuntimeWrites({
        writes: extracted,
        fileMap: input.fileMap,
        persistMutation: input.persistMutation,
        source: 'xml',
        onTimeline: input.onTimeline,
      })
      writes.push(...accepted)
    }
  }
  if (input.mustApply && writes.length === 0) {
    const toolRetry = `${input.prompt}

CRITICAL: Call apply_patch now with full file contents for every file you need to change.`
    text =
      (await run(
        { type: 'tool', toolName: 'apply_patch' },
        Math.min(4, stepBudget),
        toolRetry,
        true
      )) || text
  }
  // Last chance: harvest XML file actions — only accept after Phase 2 persist when wired.
  if (writes.length === 0) {
    const harvested = await acceptRuntimeWrites({
      writes: extractWritesFromXml(text),
      fileMap: input.fileMap,
      persistMutation: input.persistMutation,
      source: 'xml',
      onTimeline: input.onTimeline,
    })
    writes.push(...harvested)
  }
  return { text, writes: dedupeWrites(writes), error: writes.length === 0 ? lastError : undefined }
}

async function runXmlWritePass(input: {
  modelId: string
  prompt: string
  abortSignal?: AbortSignal
}): Promise<string> {
  const usedModelId = resolveModelId(input.modelId)
  try {
    const result = streamText({
      model: myProvider.languageModel(usedModelId),
      maxRetries: maxRetriesFor(usedModelId),
      system: PAGE_WRITE_SYSTEM,
      prompt: input.prompt,
      ...(input.abortSignal && { abortSignal: input.abortSignal }),
      providerOptions: buildProviderOptions(),
    })
    return await readModelText(result)
  } catch (error) {
    const info = describeProviderError(error)
    if (info.fatal) {
      if (failOverFromOpenAI(usedModelId, info)) return runXmlWritePass(input)
      throw new ProviderFatalError(usedModelId, info)
    }
    console.error(`Agent XML write model ${usedModelId} failed: ${info.message}`)
    return ''
  }
}

function routeToPagePath(route: string): string {
  const clean = route.replace(/^\.\//, '').trim()
  if (clean.startsWith('src/')) {
    return clean
  }
  if (clean === '/' || clean === '') {
    // Template App.tsx mounts Index at "/". Home.tsx is ignored unless App is rewritten.
    return TEMPLATE_HOME_PATH
  }
  const slug = clean.replace(/^\//, '').replace(/\/+/g, '-')
  const name = slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
  return `src/pages/${name || 'Page'}.tsx`
}

function buildPageWriteTargets(
  items: CompletenessItem[]
): Array<{ path: string; title: string; route: string }> {
  const targets: Array<{ path: string; title: string; route: string }> = []
  const seen = new Set<string>()
  const push = (path: string, title: string, route: string) => {
    const key = path.replace(/^\.\//, '')
    if (seen.has(key)) {
      return
    }
    seen.add(key)
    targets.push({ path: key, title, route })
  }

  // App shell first so nav exists even if later pages partially fail.
  push('src/App.tsx', 'App shell with routes and nav', 'src/App.tsx')

  for (const item of items) {
    if (item.path.startsWith('src/')) {
      push(item.path, item.title, item.path)
      continue
    }
    push(routeToPagePath(item.path), item.title, item.path)
  }

  // Cap to keep request time bounded on VPS.
  return targets.slice(0, 8)
}

function collectWritesFromSteps(steps: unknown[], writes: AgentWrite[]) {
  for (const step of steps as Array<{
    toolCalls?: Array<{ toolName?: string; input?: AgentWrite; args?: AgentWrite }>
    toolResults?: Array<{
      toolName?: string
      input?: AgentWrite
      args?: AgentWrite
      output?: unknown
      result?: unknown
    }>
  }>) {
    collectWritesFromCalls(step.toolCalls || [], writes)
    for (const result of step.toolResults || []) {
      const toolName = result.toolName
      if (toolName !== 'write_file' && toolName !== 'apply_patch') {
        continue
      }
      const rawPayload = result.input || result.args
      const payload = typeof rawPayload === 'string' ? parseToolPayload(rawPayload) : rawPayload
      if (payload?.path && payload.content) {
        writes.push({
          path: payload.path,
          content: payload.content,
          description: payload.description || `Update ${payload.path}`,
        })
      }
    }
  }
}

function collectWritesFromCalls(calls: unknown, writes: AgentWrite[]) {
  for (const call of calls as Array<{
    toolName?: string
    name?: string
    input?: AgentWrite | string
    args?: AgentWrite | string
    arguments?: AgentWrite | string
  }>) {
    const toolName = call.toolName || call.name
    if (toolName !== 'write_file' && toolName !== 'apply_patch') {
      continue
    }
    const rawPayload = call.input || call.args || call.arguments
    const payload = typeof rawPayload === 'string' ? parseToolPayload(rawPayload) : rawPayload
    if (payload?.path && payload.content) {
      writes.push({
        path: payload.path,
        content: payload.content,
        description: payload.description || `Update ${payload.path}`,
      })
    }
  }
}

function parseToolPayload(payload: string): AgentWrite | undefined {
  try {
    const parsed = JSON.parse(payload) as AgentWrite
    return parsed && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

async function readModelText(result: { text: PromiseLike<string> }): Promise<string> {
  try {
    return await result.text
  } catch (error) {
    if (describeProviderError(error).fatal) throw error
    const details =
      (error as { cause?: { message?: string } })?.cause?.message ||
      (error instanceof Error ? error.message : String(error))
    throw new Error(details)
  }
}
