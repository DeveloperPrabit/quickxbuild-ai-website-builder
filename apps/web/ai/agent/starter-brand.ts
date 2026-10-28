/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * starter-brand.ts — Detect leftover ecommerce/agency starter branding
 */

const STARTER_BRAND =
  /QuickXBuild Ecommerce|Welcome to QuickXBuild Ecommerce|admin@admin\.com|browse the store|Techspire Global|Your app is ready/i

const ECOMMERCE_PROMPT =
  /\b(shop|catalog|storefront|ecommerce|e-commerce|clothing|products?\s+store)\b/i

export function promptWantsEcommerce(prompt: string): boolean {
  return ECOMMERCE_PROMPT.test(prompt)
}

export function hasStarterBrand(content: string | undefined | null): boolean {
  return Boolean(content && STARTER_BRAND.test(content))
}

/** Home file the Vite template actually mounts at `/`. */
export const TEMPLATE_HOME_PATH = 'src/pages/Index.tsx'

function norm(path: string): string {
  return path.replace(/^\.\//, '')
}

/**
 * True when Preview at `/` would still show the starter (or a Home.tsx the router ignores).
 * Full builds must rewrite src/pages/Index.tsx — writing only Home.tsx leaves ecommerce/starter live.
 */
export function homeNeedsProductRewrite(
  prompt: string,
  fileMap: Record<string, { content?: string }>,
  writes: Array<{ path: string; content: string }>
): boolean {
  if (promptWantsEcommerce(prompt) && !hasStarterBrand(
    [...writes].reverse().find((w) => norm(w.path) === TEMPLATE_HOME_PATH)?.content ||
      fileMap[TEMPLATE_HOME_PATH]?.content ||
      ''
  )) {
    return false
  }

  const indexWrite = [...writes].reverse().find((w) => norm(w.path) === TEMPLATE_HOME_PATH)
  if (indexWrite && !hasStarterBrand(indexWrite.content)) {
    return false
  }

  const homeWrite = [...writes].reverse().find((w) => norm(w.path) === 'src/pages/Home.tsx')
  const appContent =
    [...writes].reverse().find((w) => norm(w.path) === 'src/App.tsx')?.content ||
    fileMap['src/App.tsx']?.content ||
    fileMap['./src/App.tsx']?.content ||
    ''
  const appUsesHome =
    /from\s+['"]\.\/pages\/Home['"]/.test(appContent) || /element=\{<\s*Home[\s/>]/.test(appContent)
  if (homeWrite && appUsesHome && !hasStarterBrand(homeWrite.content)) {
    return false
  }

  const existing =
    fileMap[TEMPLATE_HOME_PATH]?.content || fileMap[`./${TEMPLATE_HOME_PATH}`]?.content || ''
  return hasStarterBrand(existing) || !indexWrite
}
