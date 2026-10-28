type FileEntry = { content?: string; code?: string }

export function fileContent(entry: FileEntry | undefined): string {
  if (!entry) {
    return ''
  }
  if (typeof entry.content === 'string') {
    return entry.content
  }
  if (typeof entry.code === 'string') {
    return entry.code
  }
  return ''
}

export function normalizeFileMap(
  fileMap: Record<string, FileEntry>
): Record<string, { content: string }> {
  const next: Record<string, { content: string }> = {}
  for (const [key, entry] of Object.entries(fileMap)) {
    const content = fileContent(entry)
    const cleaned = key.replace(/^\.\//, '')
    next[key] = { content }
    next[cleaned] = { content }
    if (!cleaned.startsWith('src/') && !cleaned.startsWith('server/')) {
      next[`src/${cleaned}`] = { content }
    }
  }
  return next
}

export function resolveFilePath(
  fileMap: Record<string, { content?: string }>,
  requested: string
): string {
  const candidates = [
    requested,
    requested.replace(/^\.\//, ''),
    `./${requested.replace(/^\.\//, '')}`,
    requested.replace(/^src\//, ''),
    `src/${requested.replace(/^\.\//, '')}`,
  ]
  return candidates.find((path) => fileMap[path]?.content != null) || requested
}
