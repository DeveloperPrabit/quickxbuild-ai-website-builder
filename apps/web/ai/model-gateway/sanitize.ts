/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * sanitize.ts — Defense-in-depth redaction before data leaves the web app.
 *
 * The model service re-sanitizes everything on ingest (app/security/sanitization.py)
 * and rejects datasets that still contain secrets.
 */

const REDACTED = '[REDACTED]'

const PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, REDACTED],
  [/\bsk-(?:ant-|proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g, REDACTED],
  [/\bAIza[0-9A-Za-z_-]{35}/g, REDACTED],
  [/\bAQ\.[A-Za-z0-9_-]{20,}/g, REDACTED],
  [/\bya29\.[0-9A-Za-z_-]{20,}/g, REDACTED],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/g, REDACTED],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, REDACTED],
  [/\b(?:(?:sk|rk)_(?:live|test)_[0-9a-zA-Z]{16,}|whsec_[A-Za-z0-9]{20,})/g, REDACTED],
  [/\bxox[abpors]-[A-Za-z0-9-]{10,}/g, REDACTED],
  [/\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, REDACTED],
  [/\b(bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi, `$1${REDACTED}`],
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^:/\s@"']+:[^@/\s"']+@/gi, `$1${REDACTED}@`],
]

const ENV_FILE = /(^|\/)\.env(\.[\w.-]+)?$/i
const ENV_FILE_SAFE = /\.env\.(example|sample|template)$/i

export function redactSecrets(text: string): string {
  let out = text
  for (const [pattern, replacement] of PATTERNS) {
    out = out.replace(pattern, replacement)
  }
  return out
}

export function isEnvFile(path: string): boolean {
  const normalized = path.replace(/\\/g, '/')
  return ENV_FILE.test(normalized) && !ENV_FILE_SAFE.test(normalized)
}
