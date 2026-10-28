import type { HistoryType } from '@quickxbuild/common'

export function formatRecentChat(messageHistory: string | null | undefined, limit = 8): string {
  if (!messageHistory) {
    return ''
  }

  let history: HistoryType = []
  try {
    history = JSON.parse(messageHistory) as HistoryType
  } catch {
    return ''
  }

  const lines: string[] = []
  for (let index = history.length - 1; index >= 0 && lines.length < limit; index -= 1) {
    const message = history[index]
    if (!message) {
      continue
    }
    if (message.type === 'user') {
      lines.unshift(`User: ${message.message}`)
    } else if (message.type === 'plan') {
      lines.unshift(`Plan: ${message.content}`)
    }
  }

  if (lines.length === 0) {
    return ''
  }

  return `<recentChat>\n${lines.join('\n')}\n</recentChat>`
}
