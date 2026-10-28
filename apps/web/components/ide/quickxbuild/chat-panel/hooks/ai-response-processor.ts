/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * ai-response-processor.ts
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

'use client'

import type { FileType, HistoryType, PlanMessageType, PlanTaskType } from '@quickxbuild/common'
import { tryCatch } from '@quickxbuild/common'
import { toast } from 'sonner'
import { useAgentBoardStore } from '@/components/ide/quickxbuild/hooks/use-agent-board-store'
import { useAgentRunStore } from '@/components/ide/quickxbuild/hooks/use-agent-run-store'
import { useTerminalStore } from '@/components/ide/quickxbuild/hooks/use-terminal-store'
import type { DetailedLoadingStatus } from '../types'
import { playNotificationSound } from '../utils'
import type { Message } from './types'

const READ_TOOLS = new Set(['read_file', 'list_dir', 'search_files'])
const COMMAND_TOOLS = new Set(['execute_command', 'run_command'])
const MAX_COMMAND_DETAIL = 4000

const readTitle = (tool: string, path: string | undefined, done = false) => {
  const name = path ? path.split('/').pop() || path : undefined
  if (tool === 'list_dir') {
    return done ? `Listed ${path || 'project'}` : `Listing ${path || 'project'}`
  }
  if (tool === 'search_files') {
    return done ? `Searched ${path || 'files'}` : `Searching ${path || 'files'}`
  }
  return done ? `Read ${name || 'file'}` : `Reading ${name || 'file'}`
}

/**
 * AI response processor
 */
export const createResponseProcessor = (
  streamingHandlers: {
    handleThinkingMessage: (message: any, planId: string) => Promise<void>
    handleThinkingCompleteMessage: (message: any, planId: string) => Promise<void>
    handleDescriptionMessage: (message: any, planId: string) => Promise<void>
    handleDescriptionCompleteMessage: (message: any, planId: string) => Promise<void>
    clearAccumulatorForPlan: (planId: string) => void
  },
  messageProcessors: {
    handleCommandMessage: (message: any, planId: string) => Promise<void>
    handleFileUpdates: (fileUpdates: FileType[], planId: string) => Promise<void>
  },
  updateHandlers: {
    updateLoadingStage: (planId: string, stage: string, progress: number) => void
    setLoading: (status: DetailedLoadingStatus) => void
    setIsLoading: (isLoading: boolean) => void
    setMessages: React.Dispatch<React.SetStateAction<HistoryType>>
  },
  projectId: string,
  updateHistoryMutation: any,
  abortSignalRef: React.MutableRefObject<AbortController | null>,
  progressRefs: {
    progressRef: React.MutableRefObject<Record<string, any>>
    stageTimersRef: React.MutableRefObject<Record<string, NodeJS.Timeout>>
  },
  onFileContentUpdate?: (path: string, content: string) => void,
  deployChanges?: () => Promise<void>
) => {
  // Handle AI response
  const processAIResponse = async (iterable: AsyncIterable<any>, planId: string) => {
    const fileUpdates: FileType[] = []
    const { updateLoadingStage, setLoading, setIsLoading, setMessages } = updateHandlers
    const { progressRef, stageTimersRef } = progressRefs

    let applyFailed = false
    let applyOk = false
    /** Phase 2: sandbox already written by Agent Runtime — browser must not re-write. */
    let runtimeSandboxPersisted = false
    const board = useAgentBoardStore.getState()
    board.reset()
    board.setPreviewStatus('applying')
    board.pushActivity('Starting…')
    useTerminalStore.getState().reset()
    useTerminalStore.getState().append({
      kind: 'info',
      text: 'Agent Runtime session started',
    })

    // Per-run Details timeline (kept across requests, keyed by planId)
    const runs = useAgentRunStore.getState()
    runs.startRun(planId)
    let runSeq = 0
    const nextRunId = (prefix: string) => `${prefix}-${++runSeq}`
    const activeWriteStep = new Map<string, { id: string; path?: string }>()
    const activeReadStep = new Map<string, string>()
    const lastEditStepByPath = new Map<string, string>()
    const activeCommandStep = new Map<string, { id: string; output: string }>()
    let runSuccess: boolean | null = null
    let agentErrorMessage: string | null = null

    const attachTasks = (tasks: PlanTaskType[]) => {
      board.setTasks(planId, tasks)
      setMessages((prev) =>
        prev.map((msg) =>
          msg.type === 'plan' && msg.planId === planId
            ? ({ ...msg, tasks } as PlanMessageType)
            : msg
        )
      )
    }

    const [, error] = await tryCatch(async () => {
      for await (const message of iterable) {
        if (abortSignalRef.current?.signal.aborted) break

        if (message.type === 'tasks') {
          attachTasks((message.data?.tasks || []) as PlanTaskType[])
        } else if (message.type === 'build_plan') {
          const items = (message.data?.items || []) as Array<{
            id: string
            label: string
            status: 'pending' | 'running' | 'done' | 'failed'
          }>
          const existing = useAgentBoardStore.getState().buildPlan
          if (existing && items.length === 1 && existing.items.some((i) => i.id === items[0]?.id)) {
            // Pass status update for a single plan item
            useAgentBoardStore.getState().updateBuildPlanItem(items[0]!.id, items[0]!.status)
          } else {
            useAgentBoardStore.getState().setBuildPlan(planId, {
              brandName: message.data?.brandName || existing?.brandName,
              vertical: message.data?.vertical || existing?.vertical,
              items:
                existing && items.length < existing.items.length
                  ? existing.items.map((item) => {
                      const update = items.find((u) => u.id === item.id)
                      return update ? { ...item, status: update.status } : item
                    })
                  : items,
            })
            if (!existing) {
              useAgentBoardStore.getState().pushActivity(
                `Build plan: ${message.data?.brandName || 'product'} (${items.length} steps)`
              )
              useTerminalStore.getState().append({
                kind: 'info',
                text: `Build plan ready for ${message.data?.brandName || 'product'} — ${items.length} steps`,
              })
            }
          }
        } else if (message.type === 'progress') {
          const content = message.data?.content || ''
          if (content) {
            useAgentBoardStore.getState().pushActivity(content)
            // Mirror into Thinking panel so users see live status (not an empty skeleton).
            await streamingHandlers.handleThinkingMessage(
              {
                type: 'thinking',
                planId,
                data: { content: `${content}\n` },
              },
              planId
            )
          }
        } else if (message.type === 'timeline') {
          const step = message.data
          if (step?.title) {
            const boardState = useAgentBoardStore.getState()
            const path = step.path ? String(step.path) : undefined
            boardState.pushTimeline({
              id: step.id,
              kind: step.kind || 'check',
              title:
                step.status === 'running' && path && step.kind === 'edit'
                  ? `Writing ${path}`
                  : step.title,
              detail: step.detail,
              path,
              durationMs: step.durationMs,
              status: step.status || 'done',
            })
            if (step.kind === 'summary' && step.detail) {
              boardState.setSummary(step.detail)
            }
            // Details view: tool events already cover per-file edits, so skip path-bearing edit rows.
            if (!(step.kind === 'edit' && path)) {
              const status = step.status || 'done'
              const isThought = step.kind === 'thought'
              const seconds =
                step.durationMs && step.durationMs > 0
                  ? Math.max(1, Math.round(step.durationMs / 1000))
                  : null
              useAgentRunStore.getState().pushStep(planId, {
                id: step.id ? `tl-${step.id}` : undefined,
                kind: isThought
                  ? 'thought'
                  : step.kind === 'summary'
                    ? 'summary'
                    : step.kind === 'terminal'
                      ? 'terminal'
                      : 'check',
                title:
                  isThought && status !== 'running' && seconds
                    ? `Thought for ${seconds}s`
                    : String(step.title),
                detail: step.detail ? String(step.detail) : undefined,
                path,
                status,
                durationMs: step.durationMs,
              })
            }
            if (step.kind === 'thought' && step.detail) {
              await streamingHandlers.handleThinkingMessage(
                {
                  type: 'thinking',
                  planId,
                  data: { content: `${step.detail}\n` },
                },
                planId
              )
            }
            if (step.kind === 'edit' || step.kind === 'check' || step.kind === 'verify') {
              boardState.pushActivity(
                path && step.status === 'running' && step.kind === 'edit'
                  ? `Writing ${path}`
                  : path
                    ? `${step.title} · ${path}`
                    : step.title
              )
            }
          }
        } else if (
          message.type === 'agent_start' ||
          message.type === 'step_start' ||
          message.type === 'tool_start' ||
          message.type === 'tool_result' ||
          message.type === 'file_write' ||
          message.type === 'file_patch' ||
          message.type === 'command_start' ||
          message.type === 'command_output' ||
          message.type === 'command_result' ||
          message.type === 'build_start' ||
          message.type === 'build_result' ||
          message.type === 'agent_done' ||
          message.type === 'agent_error'
        ) {
          // Phase 1/2/3 Agent Runtime events — viewer only (no private CoT).
          const boardState = useAgentBoardStore.getState()
          if (message.type === 'agent_start') {
            boardState.pushTimeline({
              kind: 'check',
              title: 'Agent started',
              status: 'running',
              id: 'agent-start',
            })
            boardState.pushActivity('Agent started')
          } else if (message.type === 'step_start') {
            const title = message.data?.title || message.data?.step || 'Step'
            boardState.pushTimeline({
              kind: 'check',
              title: String(title),
              status: 'running',
            })
            boardState.pushActivity(String(title))
          } else if (message.type === 'command_start' || message.type === 'build_start') {
            const command = String(message.data?.command || 'command')
            const why = message.data?.why
              ? String(message.data.why)
              : message.data?.label
                ? String(message.data.label)
                : undefined
            boardState.pushTimeline({
              kind: 'terminal',
              title: command,
              detail: why,
              status: 'running',
              id: `cmd-${command}`,
            })
            boardState.pushActivity(`$ ${command}`)
            useTerminalStore.getState().append({
              kind: 'command',
              text: command,
              why,
              id: `cmd-line-${command}`,
            })
            const cmdStepId = nextRunId('cmd')
            activeCommandStep.set(command, { id: cmdStepId, output: '' })
            useAgentRunStore.getState().pushStep(planId, {
              id: cmdStepId,
              kind: 'terminal',
              title: command,
              detail: why,
              status: 'running',
            })
            await streamingHandlers.handleThinkingMessage(
              {
                type: 'thinking',
                data: { content: `\n$ ${command}\n` },
                planId,
              },
              planId
            )
          } else if (message.type === 'command_output') {
            const command = String(message.data?.command || 'command')
            const chunk = String(message.data?.chunk || '').slice(0, 2000)
            const stream = String(message.data?.stream || 'stdout')
            if (chunk) {
              boardState.pushTimeline({
                kind: 'terminal',
                title: command,
                detail: chunk,
                status: 'running',
                id: `cmd-${command}`,
              })
              useTerminalStore.getState().append({
                kind: stream === 'stderr' ? 'stderr' : 'stdout',
                text: chunk,
              })
              const active = activeCommandStep.get(command)
              if (active) {
                active.output = (active.output + chunk).slice(-MAX_COMMAND_DETAIL)
                useAgentRunStore.getState().pushStep(planId, {
                  id: active.id,
                  kind: 'terminal',
                  title: command,
                  detail: active.output,
                })
              }
            }
          } else if (message.type === 'command_result' || message.type === 'build_result') {
            const command = String(message.data?.command || 'command')
            const ok = message.data?.ok !== false && message.data?.exitCode !== 1
            const exitCode = message.data?.exitCode
            boardState.pushTimeline({
              kind: 'terminal',
              title: command,
              detail:
                exitCode != null
                  ? `exit ${exitCode}`
                  : ok
                    ? 'completed'
                    : 'failed',
              status: ok ? 'done' : 'failed',
              id: `cmd-${command}`,
            })
            boardState.pushActivity(ok ? `$ ${command} ✓` : `$ ${command} ✗`)
            useTerminalStore.getState().append({
              kind: ok ? 'info' : 'stderr',
              text:
                exitCode != null
                  ? `exit ${exitCode}`
                  : ok
                    ? 'completed'
                    : 'failed',
            })
            const activeCmd = activeCommandStep.get(command)
            const exitLine = exitCode != null ? `exit ${exitCode}` : ok ? 'completed' : 'failed'
            useAgentRunStore.getState().pushStep(planId, {
              id: activeCmd?.id || nextRunId('cmd'),
              kind: 'terminal',
              title: command,
              detail: activeCmd?.output ? `${activeCmd.output}\n${exitLine}` : exitLine,
              status: ok ? 'done' : 'failed',
            })
            activeCommandStep.delete(command)
            // Mark matching scaffold/verify build_plan items when commands finish
            const plan = useAgentBoardStore.getState().buildPlan
            if (plan) {
              const installLike = /install|add/i.test(command)
              const buildLike = /build|typecheck|test|verify/i.test(command)
              for (const item of plan.items) {
                if (
                  (installLike && item.id === 'scaffold') ||
                  (buildLike && (item.id === 'verify' || item.id === 'scaffold'))
                ) {
                  useAgentBoardStore
                    .getState()
                    .updateBuildPlanItem(item.id, ok ? 'done' : 'failed')
                }
              }
            }
          } else if (message.type === 'tool_start') {
            const tool = message.data?.tool || 'tool'
            const path = message.data?.path ? String(message.data.path) : undefined
            const isWrite = tool === 'write_file' || tool === 'apply_patch'
            const isRead = READ_TOOLS.has(tool)
            const title = isWrite
              ? path
                ? `Writing ${path}`
                : 'Writing file…'
              : path
                ? `${tool}: ${path}`
                : `Calling ${tool}`
            // Write rows are keyed per path so each edited file keeps its own row.
            if (!isWrite || path) {
              boardState.pushTimeline({
                kind: isWrite ? 'edit' : 'check',
                title,
                path,
                status: 'running',
                id: isWrite ? `tool-active-${tool}-${path}` : `tool-start-${tool}-${path || 'pending'}`,
              })
            }
            boardState.pushActivity(path ? `${isWrite ? 'Writing' : tool} ${path}` : title)

            const runStore = useAgentRunStore.getState()
            if (isWrite) {
              const active = activeWriteStep.get(tool)
              if (active && (!active.path || active.path === path)) {
                runStore.pushStep(planId, {
                  id: active.id,
                  kind: 'edit',
                  title: path ? `Editing ${path}` : 'Editing a file',
                  path,
                  status: 'running',
                })
                activeWriteStep.set(tool, { id: active.id, path: path || active.path })
              } else {
                const id = nextRunId('edit')
                runStore.pushStep(planId, {
                  id,
                  kind: 'edit',
                  title: path ? `Editing ${path}` : 'Editing a file',
                  path,
                  status: 'running',
                })
                activeWriteStep.set(tool, { id, path })
              }
            } else if (isRead) {
              const key = `${tool}:${path || ''}`
              const pendingId = path ? activeReadStep.get(`${tool}:`) : undefined
              if (pendingId) {
                activeReadStep.delete(`${tool}:`)
                activeReadStep.set(key, pendingId)
                runStore.pushStep(planId, {
                  id: pendingId,
                  kind: 'read',
                  title: readTitle(tool, path),
                  path,
                  status: 'running',
                })
              } else if (!activeReadStep.has(key)) {
                const id = nextRunId('read')
                activeReadStep.set(key, id)
                runStore.pushStep(planId, {
                  id,
                  kind: 'read',
                  title: readTitle(tool, path),
                  path,
                  status: 'running',
                })
              }
            } else if (!COMMAND_TOOLS.has(tool)) {
              runStore.pushStep(planId, {
                id: `tool-${tool}-${path || 'any'}`,
                kind: 'check',
                title: tool === 'generate_image' ? 'Generating image' : `Calling ${tool}`,
                path,
                status: 'running',
              })
            }
          } else if (message.type === 'tool_result') {
            const tool = message.data?.tool || 'tool'
            const ok = message.data?.ok !== false
            const path = message.data?.path ? String(message.data.path) : undefined
            const isWrite = tool === 'write_file' || tool === 'apply_patch'
            const detail = message.data?.detail ? String(message.data.detail) : undefined
            boardState.pushTimeline({
              kind: ok ? (isWrite ? 'edit' : 'check') : 'verify',
              title: ok
                ? path
                  ? isWrite
                    ? `Wrote ${path.split('/').pop() || path}`
                    : `${tool} completed`
                  : `${tool} completed`
                : path
                  ? `${tool} failed (${path})`
                  : `${tool} failed`,
              path,
              detail,
              status: ok ? 'done' : 'failed',
              id: isWrite ? `tool-active-${tool}-${path || 'pending'}` : undefined,
            })
            boardState.pushActivity(
              ok
                ? path
                  ? `Wrote ${path}`
                  : `${tool} completed`
                : path
                  ? `${tool} failed: ${path}`
                  : `${tool} failed`
            )

            const runStore = useAgentRunStore.getState()
            if (isWrite) {
              const active = activeWriteStep.get(tool)
              const id = active?.id || nextRunId('edit')
              const finalPath = path || active?.path
              runStore.pushStep(planId, {
                id,
                kind: 'edit',
                title: finalPath
                  ? ok
                    ? `Edited ${finalPath}`
                    : `Edit failed: ${finalPath}`
                  : ok
                    ? 'Edited a file'
                    : 'Edit failed',
                path: finalPath,
                detail,
                status: ok ? 'done' : 'failed',
              })
              if (finalPath) lastEditStepByPath.set(finalPath, id)
              activeWriteStep.delete(tool)
            } else if (READ_TOOLS.has(tool)) {
              const key = `${tool}:${path || ''}`
              const id = activeReadStep.get(key) || activeReadStep.get(`${tool}:`)
              runStore.pushStep(planId, {
                id: id || nextRunId('read'),
                kind: 'read',
                title: readTitle(tool, path, true),
                path,
                detail,
                status: ok ? 'done' : 'failed',
              })
              activeReadStep.delete(key)
              activeReadStep.delete(`${tool}:`)
            } else if (!COMMAND_TOOLS.has(tool)) {
              runStore.pushStep(planId, {
                id: `tool-${tool}-${path || 'any'}`,
                kind: 'check',
                title: tool === 'generate_image' ? 'Generated image' : `${tool} completed`,
                path,
                detail,
                status: ok ? 'done' : 'failed',
              })
            }
          } else if (message.type === 'file_write' || message.type === 'file_patch') {
            // Authoritative sandbox mutation already happened server-side.
            if (message.data?.persistedToSandbox === true) {
              runtimeSandboxPersisted = true
              applyOk = true
            }
            const path = message.data?.path ? String(message.data.path) : 'file'
            const writeTool = message.type === 'file_patch' ? 'apply_patch' : 'write_file'
            const description = message.data?.description
              ? String(message.data.description)
              : undefined
            boardState.pushTimeline({
              kind: 'edit',
              title:
                message.type === 'file_patch'
                  ? `Patched ${path.split('/').pop() || path}`
                  : `Wrote ${path.split('/').pop() || path}`,
              path,
              detail: description,
              status: 'done',
              id: `tool-active-${writeTool}-${path}`,
            })
            boardState.pushActivity(
              message.type === 'file_patch' ? `Patched ${path}` : `Wrote ${path}`
            )
            const runStore = useAgentRunStore.getState()
            const existingId = lastEditStepByPath.get(path) || activeWriteStep.get(writeTool)?.id
            if (existingId) {
              runStore.pushStep(planId, {
                id: existingId,
                kind: 'edit',
                title: `Edited ${path}`,
                path,
                detail: description,
              })
            } else {
              const id = nextRunId('edit')
              runStore.pushStep(planId, {
                id,
                kind: 'edit',
                title: `Edited ${path}`,
                path,
                detail: description,
                status: 'done',
              })
              lastEditStepByPath.set(path, id)
            }
          } else if (message.type === 'agent_done') {
            const success = Boolean(message.data?.success)
            boardState.pushTimeline({
              kind: 'summary',
              title: success ? 'Agent completed' : 'Agent finished without success',
              status: success ? 'done' : 'failed',
              id: 'agent-done',
            })
            boardState.pushActivity(success ? 'Agent completed' : 'Agent finished')
            // Finalize at stream end so late file actions still count toward the summary.
            runSuccess = success
          } else if (message.type === 'agent_error') {
            const msg = message.data?.message || 'Agent error'
            boardState.pushTimeline({
              kind: 'verify',
              title: 'Agent error',
              detail: String(msg),
              status: 'failed',
              id: 'agent-error',
            })
            boardState.setPreviewStatus('failed', String(msg))
            boardState.pushActivity(String(msg))
            useAgentRunStore.getState().pushStep(planId, {
              id: 'agent-error',
              kind: 'summary',
              title: 'Agent error',
              detail: String(msg),
              status: 'failed',
            })
            useAgentRunStore.getState().finishRun(planId, 'failed')
            if (!agentErrorMessage) {
              toast.error(String(msg), { duration: 10000 })
            }
            agentErrorMessage = String(msg)
          }
        } else if (message.type === 'summary') {
          const content = message.data?.content || ''
          if (content) {
            const boardState = useAgentBoardStore.getState()
            boardState.setSummary(content)
            boardState.pushTimeline({
              kind: 'summary',
              title: content.split('\n')[0] || 'Done',
              detail: content,
              status: 'done',
            })
            useAgentRunStore.getState().pushStep(planId, {
              id: 'run-summary',
              kind: 'summary',
              title: content.split('\n')[0]?.slice(0, 120) || 'Done',
              detail: content,
              status: 'done',
            })
            await streamingHandlers.handleDescriptionCompleteMessage(
              {
                type: 'description_complete',
                planId,
                data: { content },
              },
              planId
            )
          }
        } else if (message.type === 'apply_failed') {
          // Ignore false failures when file actions already streamed (tool writes persisted).
          if (fileUpdates.length > 0 || applyOk) {
            continue
          }
          applyFailed = true
          // A specific agent_error (e.g. provider out of credits) already explained the failure.
          board.setPreviewStatus('failed', agentErrorMessage || message.data?.content)
          if (!agentErrorMessage) {
            toast.error(message.data?.content || 'Apply failed: no file changes were written.')
          }
        } else if (message.type === 'apply_ok') {
          applyOk = true
          applyFailed = false
          board.setPreviewStatus('applied', message.data?.content)
          board.pushActivity(message.data?.content || 'Files applied')
        } else if (message.type === 'research') {
          updateLoadingStage(planId, 'thinking', 8)
          const content = message.data?.content || ''
          if (content) {
            board.pushActivity(content.slice(0, 120))
          }
          await streamingHandlers.handleThinkingMessage(
            {
              type: 'thinking',
              planId,
              data: { content },
            },
            planId
          )
        } else if (message.type === 'thinking') {
          updateLoadingStage(planId, 'thinking', 20)
          await streamingHandlers.handleThinkingMessage(message, planId)
        } else if (message.type === 'thinking_complete') {
          updateLoadingStage(planId, 'thinking', 100)
          await streamingHandlers.handleThinkingCompleteMessage(message, planId)
          updateLoadingStage(planId, 'description', 0)
        } else if (message.type === 'description') {
          updateLoadingStage(planId, 'description', 30)
          await streamingHandlers.handleDescriptionMessage(message, planId)
        } else if (message.type === 'description_complete') {
          updateLoadingStage(planId, 'description', 100)
          await streamingHandlers.handleDescriptionCompleteMessage(message, planId)
          updateLoadingStage(planId, 'actions', 0)
        } else if (message.type === 'action') {
          updateLoadingStage(planId, 'actions', 50)
          if (message.data?.type === 'command') {
            // TODO fix
            await messageProcessors.handleCommandMessage(message, planId)
          } else if (message.data?.type === 'file') {
            fileUpdates.push(message.data)
            board.pushActivity(`Editing ${message.data.path}`)
            board.pushTimeline({
              kind: 'edit',
              title: `Edited ${message.data.basename || message.data.path}`,
              path: message.data.path,
              detail: message.data.description,
              status: 'done',
            })
            if (message.data.path && typeof message.data.modified === 'string') {
              useAgentRunStore.getState().upsertChange(planId, {
                path: String(message.data.path),
                original:
                  typeof message.data.original === 'string' ? message.data.original : null,
                modified: message.data.modified,
                isNew: Boolean(message.data.isNew),
              })
            }
            await messageProcessors.handleFileUpdates([message.data], planId)

            if (onFileContentUpdate && typeof onFileContentUpdate === 'function') {
              onFileContentUpdate(message.data.path, message.data.modified)
            }
          }
        }
      }

      updateLoadingStage(planId, 'complete', 100)
      playNotificationSound()
      setIsLoading(false)

      // Tool writes can land as file actions after a stale apply_failed — treat files as success.
      if (fileUpdates.length > 0) {
        applyFailed = false
        applyOk = true
        if (useAgentBoardStore.getState().previewStatus === 'failed') {
          board.setPreviewStatus('applied', 'Files applied')
        }
      }

      useAgentRunStore
        .getState()
        .finishRun(
          planId,
          (applyFailed && fileUpdates.length === 0) || (runSuccess === false && fileUpdates.length === 0)
            ? 'failed'
            : 'done'
        )

      if (applyFailed && fileUpdates.length === 0) {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.type === 'plan' && msg.planId === planId
              ? ({ ...msg, applyStatus: 'failed' } as PlanMessageType)
              : msg
          )
        )
      } else if (fileUpdates.length === 0) {
        board.setPreviewStatus('idle')
      } else if (fileUpdates.length > 0) {
        const currentMessages = await new Promise<HistoryType>((resolve) => {
          setMessages((prev) => {
            resolve(prev)
            return prev
          })
        })

        const diffMessage = currentMessages.find(
          (msg) => msg.type === 'diff' && msg.planId === planId
        )

        if (diffMessage) {
          // History may already be durable from Agent Runtime persist — skip duplicate append.
          if (!runtimeSandboxPersisted) {
            await updateHistoryMutation.mutateAsync({
              id: projectId,
              messages: [diffMessage],
            })
          }

          // Phase 2: browser must not re-write sandbox when runtime already persisted.
          if (deployChanges && !runtimeSandboxPersisted) {
            const [, deployError] = await tryCatch(async () => {
              await deployChanges()
            })

            if (deployError) {
              console.error('[Chat Panel] Failed to deploy project changes:', deployError)
              board.setPreviewStatus('failed', 'Files applied but preview sync failed.')
            } else {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.type === 'plan' && msg.planId === planId
                    ? ({ ...msg, applyStatus: 'ok' } as PlanMessageType)
                    : msg
                )
              )
            }
          } else if (runtimeSandboxPersisted) {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.type === 'plan' && msg.planId === planId
                  ? ({ ...msg, applyStatus: 'ok' } as PlanMessageType)
                  : msg
              )
            )
            board.setPreviewStatus('applied', 'Persisted to sandbox')
          }
        }
      }

      // Cleanup
      streamingHandlers.clearAccumulatorForPlan(planId)
      if (stageTimersRef.current[planId]) {
        clearInterval(stageTimersRef.current[planId])
        delete stageTimersRef.current[planId]
      }
      delete progressRef.current[planId]
    })

    if (error) {
      console.error('[Chat Panel] AI response error:', error)

      // Error cleanup
      streamingHandlers.clearAccumulatorForPlan(planId)
      if (stageTimersRef.current[planId]) {
        clearInterval(stageTimersRef.current[planId])
        delete stageTimersRef.current[planId]
      }

      useAgentRunStore.getState().finishRun(planId, 'failed')

      // Set error state
      setLoading('error')
      setIsLoading(false)

      // Determine error type and show appropriate toast notification
      let toastMessage = 'An error occurred while processing your request, please try again later.'
      let chatMessage = 'An error occurred while processing your request, please try again later.'

      if ((error as any)?.type === 'QUOTA_EXCEEDED') {
        const specificMessage =
          (error as any)?.message ||
          'Insufficient credits. Please purchase a plan or top-up your balance to continue building.'
        toastMessage = specificMessage
        chatMessage = specificMessage

        // Show toast with upgrade option for quota exceeded
        toast.error(toastMessage, {
          description: 'Purchase a plan or top up credits to continue building.',
          action: {
            label: 'Upgrade Plan',
            onClick: () => {
              // Navigate to pricing page or billing portal
              window.open('/#price', '_blank')
            },
          },
          duration: 8000,
        })
      } else if ((error as any)?.type === 'UNAUTHORIZED') {
        toastMessage = 'Please log in to continue'
        chatMessage = 'Please log in to continue'
        toast.error(toastMessage)
      } else if ((error as any)?.type === 'FORBIDDEN') {
        toastMessage = (error as any)?.message || 'Access denied. Please check your permissions.'
        chatMessage = toastMessage
        toast.error(toastMessage)
      } else {
        // For unknown errors, show the specific error message if available
        const specificMessage = (error as any)?.message || (error as any)?.details || toastMessage
        toast.error(specificMessage)
        chatMessage = specificMessage
      }

      // Add error message to chat interface
      const errorMessage: Message = {
        type: 'plan',
        content: chatMessage,
        planId,
        status: 'error',
      } as Message

      setMessages((prev) => {
        const filtered = prev.filter((msg) => !(msg.type === 'thinking' && msg.planId === planId))
        return [...filtered, errorMessage as any]
      })
    }
  }

  return {
    processAIResponse,
  }
}
