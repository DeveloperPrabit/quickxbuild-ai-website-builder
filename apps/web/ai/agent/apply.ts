const APPLY_HINT =
  /\b(implement|fix|add|save|create|make|update|change|edit|build|website|web ?site|shop|admin|product|catalog|bug|error|preview|button|page|route|api|signup|login|auth|gym|fitness)\b/i

const FILE_ACTION_RE = /<action\b(?=[^>]*\btype=["']file["'])[^>]*>[\s\S]*?<\/action>/i

export function requiresApply(prompt: string, isFileEdit = false): boolean {
  if (isFileEdit) {
    return true
  }
  return APPLY_HINT.test(prompt)
}

export function hasFileActionXml(text: string): boolean {
  return FILE_ACTION_RE.test(text)
}

export const APPLY_RETRY_SUFFIX = `

CRITICAL: Your previous reply had no <action type="file">. The user asked for a code change.
You MUST emit a complete <plan> with at least one <action type="file"> that writes the full file contents.
A plan-only reply is invalid.
`

export function COMPLETENESS_RETRY_SUFFIX(missing: string[]): string {
  return `

CRITICAL: These screens are still missing: ${missing.join(', ')}.
Write finished pages for each missing path and wire them in src/App.tsx.
No stubs, TODO, or lorem. Match <designSpec> if present.
`
}

export function extractFilenames(text: string): string[] {
  const names: string[] = []
  const pattern = /filename=["']([^"']+)["']/gi
  let match: RegExpExecArray | null = pattern.exec(text)
  while (match) {
    if (match[1]) {
      names.push(match[1])
    }
    match = pattern.exec(text)
  }
  return names
}

/**
 * Pull real file writes out of model XML text.
 * Models often emit plan XML in the assistant message instead of calling tools —
 * without this, writes stay empty and the IDE never applies edits.
 */
export function extractWritesFromXml(text: string): Array<{
  path: string
  content: string
  description: string
}> {
  const writes: Array<{ path: string; content: string; description: string }> = []
  if (!text) {
    return writes
  }

  // Models often wrap plan XML in markdown fences — strip them before parsing.
  const normalized = text
    .replace(/```(?:xml|html|tsx|ts|javascript|js)?\s*/gi, '')
    .replace(/```/g, '')

  if (!normalized.includes('<action') && !normalized.includes('<file')) {
    return writes
  }

  const actionRe = /<action\b([^>]*)>([\s\S]*?)<\/action>/gi
  let actionMatch: RegExpExecArray | null = actionRe.exec(normalized)
  while (actionMatch) {
    const attrs = actionMatch[1] || ''
    const body = actionMatch[2] || ''
    if (!/\btype\s*=\s*["']file["']/i.test(attrs)) {
      actionMatch = actionRe.exec(normalized)
      continue
    }

    const fileMatch = /<file\b([^>]*)>([\s\S]*?)<\/file>/i.exec(body)
    if (!fileMatch) {
      actionMatch = actionRe.exec(normalized)
      continue
    }

    const filename = /filename\s*=\s*["']([^"']+)["']/i.exec(fileMatch[1] || '')?.[1]?.trim()
    if (!filename) {
      actionMatch = actionRe.exec(normalized)
      continue
    }

    let content = fileMatch[2] || ''
    const cdata = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(content)
    if (cdata?.[1] != null) {
      content = cdata[1]
    }
    content = content.replace(/^\n+|\n+$/g, '')
    if (content.trim().length < 2) {
      actionMatch = actionRe.exec(normalized)
      continue
    }

    let description = `Update ${filename}`
    const descMatch = /<description\b[^>]*>([\s\S]*?)<\/description>/i.exec(body)
    if (descMatch?.[1]) {
      const descCdata = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(descMatch[1])
      description = (descCdata?.[1] ?? descMatch[1]).trim() || description
    }

    writes.push({ path: filename, content, description })
    actionMatch = actionRe.exec(normalized)
  }

  // Fallback: bare <file filename="..."> blocks without wrapping <action>.
  if (writes.length === 0) {
    const bareFileRe = /<file\b([^>]*)>([\s\S]*?)<\/file>/gi
    let fileMatch: RegExpExecArray | null = bareFileRe.exec(normalized)
    while (fileMatch) {
      const filename = /filename\s*=\s*["']([^"']+)["']/i.exec(fileMatch[1] || '')?.[1]?.trim()
      let content = fileMatch[2] || ''
      const cdata = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(content)
      if (cdata?.[1] != null) {
        content = cdata[1]
      }
      content = content.replace(/^\n+|\n+$/g, '')
      if (filename && content.trim().length >= 2) {
        writes.push({ path: filename, content, description: `Update ${filename}` })
      }
      fileMatch = bareFileRe.exec(normalized)
    }
  }

  return writes
}

export function stringToTextStream(text: string): ReadableStream<string> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(text)
      controller.close()
    },
  })
}
