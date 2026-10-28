/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * vite-diagnostics.ts — Normalize build/Vite errors into ViteDiagnostic (Phase 3)
 */

import {
  type DiagnosticSource,
  ViteDiagnostic,
  type ViteDiagnostic as ViteDiagnosticType,
} from './runtime-events'

export type { ViteDiagnosticType as ViteDiagnostic }

/**
 * Parse Vite / esbuild / rollup / tsc style errors into a normalized diagnostic.
 * Returns null when no useful diagnostic can be extracted.
 */
export function normalizeViteDiagnostic(input: {
  stdout?: string
  stderr?: string
  message?: string
  source?: DiagnosticSource
}): ViteDiagnosticType | null {
  const blob = [input.stderr, input.stdout, input.message].filter(Boolean).join('\n')
  if (!blob.trim()) return null

  const source: DiagnosticSource = input.source || inferSource(blob)

  // Vite / rollup: Error: Failed to resolve import "x" from "file"
  const resolveImport = blob.match(
    /Failed to resolve import\s+["']([^"']+)["']\s+from\s+["']([^"']+)["']/i
  )
  if (resolveImport) {
    return ViteDiagnostic.parse({
      message: `Failed to resolve import "${resolveImport[1]}" from "${resolveImport[2]}"`,
      file: resolveImport[2],
      stack: truncate(blob),
      source: source === 'preview-smoke' ? source : 'vite-transform',
    })
  }

  // Vite transform: file:line:col: error message
  const loc = blob.match(
    /(?:^|\n)\s*((?:\.\/)?[\w./-]+\.[tj]sx?)\s*:\s*(\d+)\s*:\s*(\d+)\s*[:\s]+([^\n]+)/
  )
  if (loc) {
    const message = loc[4]?.trim()
    if (!message) return null
    return ViteDiagnostic.parse({
      message,
      file: loc[1]?.replace(/\\/g, '/'),
      line: Number(loc[2]),
      column: Number(loc[3]),
      stack: truncate(blob),
      source,
    })
  }

  // esbuild: path:line:col: ERROR: msg
  const esbuild = blob.match(
    /((?:\.\/)?[\w./-]+\.[tj]sx?):(\d+):(\d+):\s*(?:ERROR|error):\s*([^\n]+)/i
  )
  if (esbuild) {
    const message = esbuild[4]?.trim()
    if (!message) return null
    return ViteDiagnostic.parse({
      message,
      file: esbuild[1]?.replace(/\\/g, '/'),
      line: Number(esbuild[2]),
      column: Number(esbuild[3]),
      stack: truncate(blob),
      source: 'build',
    })
  }

  // Cannot find module 'x' / Module not found: Error: Can't resolve 'x'
  const missing = blob.match(
    /(?:Cannot find module|Can't resolve|Could not resolve)\s+['"]([^'"]+)['"]/i
  )
  if (missing) {
    const fileMatch = blob.match(/(?:from|in)\s+['"]([^'"]+\.[tj]sx?)['"]/i)
    return ViteDiagnostic.parse({
      message: `Cannot resolve module "${missing[1]}"`,
      file: fileMatch?.[1],
      stack: truncate(blob),
      source: source === 'build' ? 'build' : 'vite-transform',
    })
  }

  // JSX / syntax
  const syntax = blob.match(/(?:SyntaxError|Unexpected token|Expected .+ but found)[^\n]*/i)
  if (syntax) {
    const message = syntax[0]?.trim()
    if (!message) return null
    const fileMatch = blob.match(/((?:\.\/)?[\w./-]+\.[tj]sx?)/)
    return ViteDiagnostic.parse({
      message,
      file: fileMatch?.[1]?.replace(/\\/g, '/'),
      stack: truncate(blob),
      source: source === 'build' ? 'build' : 'vite-transform',
    })
  }

  // Generic first Error: line
  const generic = blob.match(/Error:\s*([^\n]+)/)
  if (generic) {
    const message = generic[1]?.trim()
    if (!message) return null
    return ViteDiagnostic.parse({
      message,
      stack: truncate(blob),
      source,
    })
  }

  // Last resort: first non-empty line if it looks like an error
  const first = blob
    .split('\n')
    .map((l) => l.trim())
    .find((l) => /error|failed|cannot|unable/i.test(l))
  if (first) {
    return ViteDiagnostic.parse({
      message: first.slice(0, 500),
      stack: truncate(blob),
      source,
    })
  }

  return null
}

function inferSource(blob: string): DiagnosticSource {
  if (/preview|smoke/i.test(blob)) return 'preview-smoke'
  if (/hmr/i.test(blob)) return 'vite-hmr'
  if (/vite|transform|failed to resolve import/i.test(blob)) return 'vite-transform'
  return 'build'
}

function truncate(text: string, max = 8000): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n…[truncated]`
}

/** Extract a missing package name from a diagnostic for install repair. */
export function extractMissingPackage(diagnostic: ViteDiagnosticType): string | null {
  const fromMsg =
    diagnostic.message.match(/import\s+"([^"./][^"]*)"/)?.[1] ||
    diagnostic.message.match(/module\s+"([^"./][^"]*)"/)?.[1] ||
    diagnostic.message.match(/resolve\s+"([^"./][^"]*)"/)?.[1]
  if (!fromMsg) return null
  // Skip relative paths
  if (fromMsg.startsWith('.') || fromMatchIsRelative(fromMsg)) return null
  // Scoped or bare package (first segment)
  if (fromMsg.startsWith('@')) {
    const parts = fromMsg.split('/')
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : fromMsg
  }
  return fromMsg.split('/')[0] || null
}

function fromMatchIsRelative(name: string): boolean {
  return name.startsWith('/') || name.startsWith('#')
}
