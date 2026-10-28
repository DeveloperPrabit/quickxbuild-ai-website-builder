/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * tools.ts — Agent Runtime tools (Phase 2: immediate sandbox persistence)
 */

import { tool } from 'ai'
import { z } from 'zod/v4'
import { resolveFilePath } from './file-map'
import {
  type GenerateImageResult,
  type ImageBudget,
  MAX_GENERATED_IMAGES,
  runGenerateImage,
} from './generate-image'
import type {
  DurableMutationRecord,
  MutationOperation,
  PersistMutationResult,
} from './persist-mutation'
import { persistAgentMutation } from './persist-mutation'
import type { RuntimeEmitter } from './runtime-emitter'
import { formatCommandLabel, resolveAllowlistedCommand } from './sandbox-commands'
import type { SandboxFilesystem } from './sandbox-fs'
import type { AgentWrite } from './xml'

const READ_REASON_HINT =
  'One short sentence shown to the user: why you are looking at this (e.g. "Checking the current services layout").'
const WRITE_DESCRIPTION_HINT =
  'One sentence shown to the user describing what changed in this file (e.g. "Moved the CTP block above the NDIS cards").'

type FileEntry = { content?: string }

export type PersistMutationFn = (input: {
  operation: MutationOperation
  path: string
  content: string
  description: string
  originalContent?: string | null
}) => Promise<PersistMutationResult>

/** Options passed into the agent tool set for image generation + Phase 2 persist. */
export type AgentToolsOptions = {
  userPlan: string
  modelId?: string
  abortSignal?: AbortSignal
  imageBudget?: ImageBudget
  /** When true, only expose write_file + apply_patch (surgical fixes). */
  writeOnly?: boolean
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
  /** Test hook to replace runGenerateImage. */
  generateImage?: (input: {
    prompt: string
    path?: string
    alt?: string
    userPlan: string
    modelId?: string
    abortSignal?: AbortSignal
  }) => Promise<GenerateImageResult>
  /**
   * Phase 2: authoritative mutation pipeline (lock → sandbox → history → event).
   * When provided, write_file / apply_patch must succeed here before reporting success.
   */
  persistMutation?: PersistMutationFn
  /** Optional emitter reference (events are emitted inside persistMutation). */
  emitter?: RuntimeEmitter
  /**
   * Phase 3: run allowlisted install/build commands against the sandbox root.
   * Required for install_packages / execute_command / run_build tools.
   */
  runSandboxCommand?: (
    spec: import('./sandbox-commands').AllowlistedCommandSpec
  ) => Promise<import('./sandbox-commands').SandboxCommandResult>
}

function toolResultPayload(result: PersistMutationResult, verb: string) {
  if (result.ok) {
    return {
      ok: true as const,
      persistedToSandbox: true as const,
      path: result.path,
      bytes: result.bytes,
      message: `${verb} ${result.path}`,
    }
  }
  return {
    ok: false as const,
    persistedToSandbox: false as const,
    path: result.path,
    error: result.error,
    message: `Failed to ${verb.toLowerCase()} ${result.path}: ${result.error}`,
  }
}

export function createAgentTools(fileMap: Record<string, FileEntry>, options?: AgentToolsOptions) {
  const writes: AgentWrite[] = []
  const imageBudget = options?.imageBudget || {
    count: 0,
    max: MAX_GENERATED_IMAGES,
  }

  const applyMutation = async (
    operation: MutationOperation,
    path: string,
    content: string,
    description: string
  ) => {
    const resolved = resolveFilePath(fileMap, path)
    const original = fileMap[resolved]?.content ?? fileMap[path]?.content ?? null

    if (!options?.persistMutation) {
      // Legacy / unit-test path without sandbox wiring — RAM only (not Phase 2 production).
      writes.push({ path: resolved, content, description })
      fileMap[resolved] = { content }
      fileMap[path] = { content }
      options?.onProgress?.(`Editing ${resolved}`)
      options?.onTimeline?.({
        kind: 'edit',
        title: `Edited ${resolved.split('/').pop() || resolved}`,
        path: resolved,
        detail: description,
        status: 'done',
      })
      return {
        ok: true as const,
        persistedToSandbox: false as const,
        path: resolved,
        message: `Wrote ${resolved} (memory-only; no sandbox adapter)`,
      }
    }

    const result = await options.persistMutation({
      operation,
      path: resolved,
      content,
      description,
      originalContent: original,
    })

    if (!result.ok) {
      options?.onTimeline?.({
        kind: 'edit',
        title: `Failed ${resolved.split('/').pop() || resolved}`,
        path: resolved,
        detail: result.error,
        status: 'failed',
      })
      return toolResultPayload(result, operation === 'apply_patch' ? 'Patched' : 'Wrote')
    }

    writes.push({ path: result.path, content, description })
    fileMap[result.path] = { content }
    fileMap[path] = { content }
    options?.onProgress?.(`Editing ${result.path}`)
    options?.onTimeline?.({
      kind: 'edit',
      title: `Edited ${result.path.split('/').pop() || result.path}`,
      path: result.path,
      detail: description,
      status: 'done',
    })
    return toolResultPayload(result, operation === 'apply_patch' ? 'Patched' : 'Wrote')
  }

  const tools = {
    ...(options?.writeOnly
      ? {}
      : {
          list_dir: tool({
            description: 'List this user project file paths',
            inputSchema: z.object({
              prefix: z.string().optional().default(''),
              reason: z.string().optional().describe(READ_REASON_HINT),
            }),
            execute: async ({ prefix }) => {
              const paths = [...new Set(Object.keys(fileMap))].filter((path) =>
                prefix ? path.startsWith(prefix) : true
              )
              return paths.slice(0, 80).join('\n') || 'No files'
            },
          }),
          read_file: tool({
            description: 'Read a file from this user project',
            inputSchema: z.object({
              path: z.string(),
              reason: z.string().optional().describe(READ_REASON_HINT),
            }),
            execute: async ({ path }) => {
              const resolved = resolveFilePath(fileMap, path)
              return fileMap[resolved]?.content ?? `File not found: ${path}`
            },
          }),
          search_files: tool({
            description: 'Search this user project paths and contents',
            inputSchema: z.object({
              query: z.string(),
              reason: z.string().optional().describe(READ_REASON_HINT),
            }),
            execute: async ({ query }) => {
              const needle = query.toLowerCase()
              const hits: string[] = []
              const seen = new Set<string>()
              for (const [path, file] of Object.entries(fileMap)) {
                const clean = path.replace(/^\.\//, '')
                if (seen.has(clean)) {
                  continue
                }
                if (
                  path.toLowerCase().includes(needle) ||
                  file.content?.toLowerCase().includes(needle)
                ) {
                  seen.add(clean)
                  hits.push(clean)
                }
                if (hits.length >= 20) {
                  break
                }
              }
              return hits.join('\n') || 'No matches'
            },
          }),
          generate_image: tool({
            description:
              'Generate a real image asset for this user project (hero, product, illustration). Writes src/assets/generated/<name>.ts exporting { src, alt }. Then write_file to import and use it — never leave gray boxes or placeholder URLs.',
            inputSchema: z.object({
              prompt: z.string().describe('Visual description of the image to generate'),
              path: z
                .string()
                .optional()
                .describe(
                  'Optional filename or path; always stored under src/assets/generated/*.ts'
                ),
              description: z.string().describe('Short label for this asset write'),
            }),
            execute: async ({ prompt, path, description }) => {
              if (imageBudget.count >= imageBudget.max) {
                return `Image limit reached (${imageBudget.max} per request). Reuse existing assets under src/assets/generated/.`
              }
              if (!options?.userPlan) {
                return 'Image generation requires a user plan context'
              }

              const result = await (options.generateImage || runGenerateImage)({
                prompt,
                path,
                alt: description,
                userPlan: options.userPlan,
                modelId: options.modelId,
                abortSignal: options.abortSignal,
              })

              if (!result.ok) {
                return `Image generation failed: ${result.error}`
              }

              imageBudget.count += 1

              if (options.persistMutation) {
                const persisted = await options.persistMutation({
                  operation: 'write_file',
                  path: result.path,
                  content: result.content,
                  description: description || `Generate ${result.path}`,
                  originalContent: null,
                })
                if (!persisted.ok) {
                  return {
                    ok: false as const,
                    persistedToSandbox: false as const,
                    path: result.path,
                    error: persisted.error,
                    message: `Image generated but sandbox persist failed: ${persisted.error}`,
                  }
                }
              }

              writes.push({
                path: result.path,
                content: result.content,
                description: description || `Generate ${result.path}`,
              })
              fileMap[result.path] = { content: result.content }
              options?.onProgress?.(`Generated image ${result.path}`)

              const moduleId = `@/${result.path.replace(/^src\//, '').replace(/\.ts$/, '')}`
              return `Generated image at ${result.path} (${result.mimeType}). Import with: import { src, alt } from '${moduleId}'. Use <img src={src} alt={alt} />. Do not paste the data URL into other files.`
            },
          }),
        }),
    write_file: tool({
      description: 'Write a complete file in this user project. Required for every code change.',
      inputSchema: z.object({
        path: z.string(),
        content: z.string(),
        description: z.string().describe(WRITE_DESCRIPTION_HINT),
      }),
      execute: async ({ path, content, description }) =>
        applyMutation('write_file', path, content, description),
    }),
    apply_patch: tool({
      description: 'Replace a complete file in this user project.',
      inputSchema: z.object({
        path: z.string(),
        content: z.string(),
        description: z.string().describe(WRITE_DESCRIPTION_HINT),
      }),
      execute: async ({ path, content, description }) =>
        applyMutation('apply_patch', path, content, description),
    }),
    ...(options?.runSandboxCommand
      ? {
          install_packages: tool({
            description:
              'Install project dependencies (allowlisted). Prefer after package.json changes.',
            inputSchema: z.object({
              packages: z.array(z.string()).optional(),
            }),
            execute: async ({ packages }) => {
              try {
                const runCommand = options.runSandboxCommand
                if (!runCommand) {
                  return { ok: false, error: 'Command runner unavailable' }
                }
                const spec = resolveAllowlistedCommand('install', { packages })
                const label = formatCommandLabel(spec)
                options.emitter?.emit({
                  type: 'command_start',
                  data: { command: label, packages },
                })
                const result = await runCommand(spec)
                if (result.stdout) {
                  options.emitter?.emit({
                    type: 'command_output',
                    data: { command: label, stream: 'stdout', chunk: result.stdout.slice(0, 4000) },
                  })
                }
                if (result.stderr) {
                  options.emitter?.emit({
                    type: 'command_output',
                    data: { command: label, stream: 'stderr', chunk: result.stderr.slice(0, 4000) },
                  })
                }
                options.emitter?.emit({
                  type: 'command_result',
                  data: {
                    command: label,
                    exitCode: result.exitCode,
                    stdout: result.stdout.slice(0, 8000),
                    stderr: result.stderr.slice(0, 8000),
                    durationMs: result.durationMs,
                  },
                })
                return {
                  ok: result.ok,
                  command: label,
                  exitCode: result.exitCode,
                  stdout: result.stdout.slice(0, 4000),
                  stderr: result.stderr.slice(0, 4000),
                  durationMs: result.durationMs,
                }
              } catch (error) {
                return {
                  ok: false,
                  error: error instanceof Error ? error.message : String(error),
                }
              }
            },
          }),
          execute_command: tool({
            description:
              'Run an allowlisted development command (install|build|typecheck|test|verify_dev). Not arbitrary shell. verify_dev runs a short production build check — never a long-lived dev server. Never npx create-react-app.',
            inputSchema: z.object({
              kind: z.enum(['install', 'build', 'typecheck', 'test', 'verify_dev']),
              packages: z.array(z.string()).optional(),
              why: z.string().optional().describe('Why this command is running (shown in Terminal)'),
            }),
            execute: async ({ kind, packages, why }) => {
              try {
                const runCommand = options.runSandboxCommand
                if (!runCommand) {
                  return { ok: false, error: 'Command runner unavailable' }
                }
                const spec = resolveAllowlistedCommand(kind, { packages })
                const label = formatCommandLabel(spec)
                options.emitter?.emit({
                  type: 'command_start',
                  data: { command: label, packages, why },
                })
                const result = await runCommand(spec)
                options.emitter?.emit({
                  type: 'command_result',
                  data: {
                    command: label,
                    exitCode: result.exitCode,
                    stdout: result.stdout.slice(0, 8000),
                    stderr: result.stderr.slice(0, 8000),
                    durationMs: result.durationMs,
                  },
                })
                return {
                  ok: result.ok,
                  command: label,
                  exitCode: result.exitCode,
                  stdout: result.stdout.slice(0, 4000),
                  stderr: result.stderr.slice(0, 4000),
                  durationMs: result.durationMs,
                }
              } catch (error) {
                return {
                  ok: false,
                  error: error instanceof Error ? error.message : String(error),
                }
              }
            },
          }),
          run_build: tool({
            description: 'Run the project build script (allowlisted).',
            inputSchema: z.object({}),
            execute: async () => {
              try {
                const runCommand = options.runSandboxCommand
                if (!runCommand) {
                  return { ok: false, error: 'Command runner unavailable' }
                }
                const spec = resolveAllowlistedCommand('build')
                const label = formatCommandLabel(spec)
                options.emitter?.emit({ type: 'build_start', data: { command: label } })
                const result = await runCommand(spec)
                if (result.ok) {
                  options.emitter?.emit({
                    type: 'build_success',
                    data: {
                      command: label,
                      exitCode: 0 as const,
                      durationMs: result.durationMs,
                    },
                  })
                } else {
                  const { normalizeViteDiagnostic } = await import('./vite-diagnostics')
                  const diagnostic = normalizeViteDiagnostic({
                    stdout: result.stdout,
                    stderr: result.stderr,
                    source: 'build',
                  })
                  options.emitter?.emit({
                    type: 'build_error',
                    data: {
                      command: label,
                      exitCode: result.exitCode,
                      stdout: result.stdout.slice(0, 8000),
                      stderr: result.stderr.slice(0, 8000),
                      durationMs: result.durationMs,
                      diagnostic: diagnostic || undefined,
                    },
                  })
                  if (diagnostic) {
                    options.emitter?.emit({ type: 'diagnostic', data: diagnostic })
                  }
                }
                return {
                  ok: result.ok,
                  command: label,
                  exitCode: result.exitCode,
                  stdout: result.stdout.slice(0, 4000),
                  stderr: result.stderr.slice(0, 4000),
                  durationMs: result.durationMs,
                }
              } catch (error) {
                return {
                  ok: false,
                  error: error instanceof Error ? error.message : String(error),
                }
              }
            },
          }),
        }
      : {}),
  }

  return { tools, writes, imageBudget }
}

/** Build a PersistMutationFn bound to sandbox + history + emitter (Phase 2/3). */
export function createPersistMutationFn(deps: {
  projectId: string
  planId: string
  sandbox: SandboxFilesystem
  appendDurableHistory: (record: DurableMutationRecord) => Promise<void>
  emitter?: RuntimeEmitter
  /** When true, Phase 3 outer lock is already held. */
  alreadyLocked?: boolean
}): PersistMutationFn {
  return async (input) =>
    persistAgentMutation({
      projectId: deps.projectId,
      planId: deps.planId,
      operation: input.operation,
      path: input.path,
      content: input.content,
      description: input.description,
      originalContent: input.originalContent,
      sandbox: deps.sandbox,
      appendDurableHistory: deps.appendDurableHistory,
      alreadyLocked: deps.alreadyLocked,
      emitFileEvent: ({ operation, path, bytes, description }) => {
        if (!deps.emitter) return
        if (operation === 'apply_patch') {
          deps.emitter.filePatch(path, bytes, description)
        } else {
          deps.emitter.fileWrite(path, bytes, description)
        }
      },
    })
}
