type FileEntry = { content?: string }

const ALWAYS_INCLUDE = [
  'server/schema.ts',
  'server/migrate.ts',
  'src/lib/api.ts',
  'src/App.tsx',
  'src/main.tsx',
  'package.json',
]

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'your', 'you',
  'add', 'update', 'change', 'edit', 'make', 'please', 'fix', 'create',
])

export function uniquePaths(fileMap: Record<string, FileEntry>): string[] {
  const seen = new Set<string>()
  const paths: string[] = []
  for (const key of Object.keys(fileMap)) {
    const clean = key.replace(/^\.\//, '')
    if (seen.has(clean) || fileMap[key]?.content == null) {
      continue
    }
    seen.add(clean)
    paths.push(clean)
  }
  return paths
}

export function pickRelevantFiles(
  fileMap: Record<string, FileEntry>,
  prompt: string,
  limit = 8
): string[] {
  const words = prompt
    .toLowerCase()
    .split(/\W+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
  const scored = uniquePaths(fileMap)
    .map((path) => {
      const lower = path.toLowerCase()
      let score = ALWAYS_INCLUDE.some((item) => lower.endsWith(item) || lower === item) ? 20 : 0
      for (const word of words) {
        if (lower.includes(word)) {
          score += 5
        }
      }
      return { path, score }
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)

  const picked: string[] = []
  const seen = new Set<string>()
  for (const path of [...ALWAYS_INCLUDE, ...scored.map((item) => item.path)]) {
    const resolved = uniquePaths(fileMap).find((item) => item === path || item.endsWith(`/${path}`))
    if (!resolved || seen.has(resolved) || fileMap[resolved]?.content == null) {
      continue
    }
    seen.add(resolved)
    picked.push(resolved)
    if (picked.length >= limit) {
      break
    }
  }
  return picked
}

export function formatRelevantFiles(
  fileMap: Record<string, FileEntry>,
  files: string[],
  indexLimit = 80,
  maxChars = 60_000
): string {
  const index = uniquePaths(fileMap).slice(0, indexLimit).join('\n')
  const wanted: string[] = []
  let used = 0
  for (const path of files) {
    const content = fileMap[path]?.content
    if (content == null) {
      continue
    }
    if (used + content.length > maxChars) {
      break
    }
    wanted.push(path)
    used += content.length
  }
  const bodies = wanted
    .map((path) => `<file path="${path}"><![CDATA[${fileMap[path]?.content || ''}]]></file>`)
    .join('\n')

  return [
    `<fileIndex>\n${index || 'No files'}\n</fileIndex>`,
    bodies ? `<relevantFiles>\n${bodies}\n</relevantFiles>` : '',
    'Use list_dir, search_files, and read_file before write_file. Do not assume unread files.',
  ]
    .filter(Boolean)
    .join('\n\n')
}
