/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * tasks.ts — Task board for multi-agent swarm (OpenAI UI + Cursor backend)
 */

import { isCursorAgentEnabled } from './cursor-bridge'
import { planSwarmTasks, type SwarmAgent } from './multi-agent'

export type AgentName =
  | 'planner'
  | 'implementer'
  | 'debugger'
  | 'openai-frontend'
  | 'cursor-backend'
  | 'cursor-debug'

export type AgentTaskStatus = 'queued' | 'running' | 'done' | 'failed' | 'blocked'

export type AgentTask = {
  id: string
  title: string
  agent: AgentName
  status: AgentTaskStatus
  files: string[]
  reason?: string
}

function mapSwarmAgent(agent: SwarmAgent): AgentName {
  if (agent === 'openai-frontend') return 'openai-frontend'
  if (agent === 'cursor-backend') return 'cursor-backend'
  if (agent === 'cursor-debug') return 'cursor-debug'
  if (agent === 'planner') return 'planner'
  return 'implementer'
}

export function planTasksFromPrompt(prompt: string): AgentTask[] {
  const swarm = planSwarmTasks(prompt, { cursorEnabled: isCursorAgentEnabled() })
  return swarm.map((task) => ({
    id: task.id,
    title: task.title,
    agent: mapSwarmAgent(task.agent),
    status: task.status === 'skipped' ? 'blocked' : (task.status as AgentTaskStatus),
    files: task.files,
    reason: task.reason,
  }))
}

export function markTasksAfterApply(
  tasks: AgentTask[],
  applied: boolean,
  reason?: string,
  files: string[] = []
): AgentTask[] {
  return tasks.map((task) => {
    if (task.agent === 'planner') {
      return { ...task, status: 'done' as const, files: task.files }
    }
    if (task.status === 'blocked') {
      return task
    }
    if (applied) {
      const owned =
        task.agent === 'cursor-backend' || task.agent === 'cursor-debug'
          ? files.filter((file) => file.startsWith('server/') || file === 'package.json')
          : task.agent === 'openai-frontend'
            ? files.filter((file) => file.startsWith('src/') || file === 'index.html')
            : files
      return {
        ...task,
        status: 'done' as const,
        files: owned.length > 0 ? owned : files.length > 0 ? files : task.files,
        reason: undefined,
      }
    }
    return { ...task, status: 'failed' as const, reason: reason || 'No file actions were applied' }
  })
}

export function buildWarmSummary(files: string[]): string {
  if (files.length === 0) {
    return 'Done. I checked your request — ask again if you want more changes.'
  }
  const listed = files.slice(0, 8).map((path) => `• ${path}`).join('\n')
  const more = files.length > 8 ? `\n• …and ${files.length - 8} more` : ''
  const names = files
    .slice(0, 3)
    .map((path) => path.split('/').pop())
    .filter(Boolean)
    .join(', ')
  return [
    `Fixed and updated your project${names ? ` (${names}${files.length > 3 ? ', …' : ''})` : ''}.`,
    '',
    'Here is what I changed:',
    listed + more,
    '',
    'Open Preview to see it live. If anything still looks wrong, tell me exactly what you see and I will fix it.',
  ].join('\n')
}
