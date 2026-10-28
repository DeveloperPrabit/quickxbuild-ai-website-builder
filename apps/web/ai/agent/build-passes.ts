/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * build-passes.ts — Ordered full-build passes (backend → scaffold → design → assets → shell → pages)
 */

import type { ProductBlueprint } from '../design/product-blueprint'

export type BuildPassId =
  | 'backend'
  | 'scaffold'
  | 'design'
  | 'assets'
  | 'shell'
  | 'pages'
  | 'seo'

export type BuildPass = {
  id: BuildPassId
  /** Matches build_plan item id when present. */
  planItemId: string
  title: string
  systemHint: string
  userHint: string
  /** Prefer these write paths in this pass. */
  focusPaths: string[]
  maxSteps: number
  forceGenerateImage?: boolean
}

/** Ordered passes for scaffold-first full builds when a ProductBlueprint is present. */
export function buildOrchestratedPasses(blueprint: ProductBlueprint): BuildPass[] {
  const brand = blueprint.brandName
  const pagePaths = blueprint.pages.map((page) => {
    if (page.path === '/') return 'src/pages/Index.tsx'
    const slug =
      page.path
        .replace(/^\//, '')
        .split('/')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('') || 'Page'
    return `src/pages/${slug}.tsx`
  })

  const backendNeeded = blueprint.backend.auth || blueprint.backend.forms
  const passes: BuildPass[] = []

  if (backendNeeded) {
    passes.push({
      id: 'backend',
      planItemId: 'backend',
      title: 'Backend / system engineering',
      systemHint:
        'Focus on server/*, auth, forms, and schema only. Do not rewrite marketing pages yet.',
      userHint: `Implement backend for ${brand}: auth=${blueprint.backend.auth} forms=${blueprint.backend.forms} tables=${blueprint.backend.tables.join(',') || 'none'}. Prefer server/* files.`,
      focusPaths: ['server/', 'src/lib/', 'package.json'],
      maxSteps: 8,
    })
  }

  passes.push(
    {
      id: 'scaffold',
      planItemId: 'scaffold',
      title: 'Scaffold / install',
      systemHint:
        'Create missing folders via write_file. Call install_packages only for allowlisted deps. Do not run arbitrary npx create-*.',
      userHint: `Scaffold for ${brand}. Terminal steps planned: ${blueprint.terminalSteps.join(' → ') || 'bun install → bun run build'}. Packages: ${blueprint.packagesToInstall.join(', ') || 'none'}.`,
      focusPaths: ['package.json', 'src/components/'],
      maxSteps: 4,
    },
    {
      id: 'design',
      planItemId: 'design',
      title: 'Design system',
      systemHint:
        'Write src/index.css with CSS variables/tokens matching the brand colors. Add Layout/Header/Footer with brand name and mobile nav. Subtle animations OK.',
      userHint: `Design system for ${brand} (${blueprint.vertical}). Colors: bg=${blueprint.colorHints.background} fg=${blueprint.colorHints.foreground} accent=${blueprint.colorHints.accent}. Tone: ${blueprint.tone}. MUST write src/index.css and a shared Header with brand "${brand}".`,
      focusPaths: ['src/index.css', 'src/components/Layout.tsx', 'src/components/Header.tsx'],
      maxSteps: 6,
    },
    {
      id: 'assets',
      planItemId: 'assets',
      title: 'Logo and assets',
      systemHint:
        blueprint.assets.logo
          ? 'You MUST call generate_image for a logo, then write src/assets/generated/logo.ts and wire it into Header.'
          : 'Optional assets only.',
      userHint: `Assets for ${brand}: logo=${blueprint.assets.logo} heroImages=${blueprint.assets.heroImages}.`,
      focusPaths: ['src/assets/generated/logo.ts', 'src/components/Header.tsx'],
      maxSteps: 5,
      forceGenerateImage: blueprint.assets.logo,
    },
    {
      id: 'shell',
      planItemId: 'shell',
      title: 'App shell routes',
      systemHint:
        'Write src/App.tsx with a route for EVERY blueprint page. Include Header/Footer. Never leave QuickXBuild Ecommerce starter routes.',
      userHint: `Wire routes for ${brand}: ${blueprint.pages.map((p) => p.path).join(', ')}.`,
      focusPaths: ['src/App.tsx'],
      maxSteps: 4,
    },
    {
      id: 'pages',
      planItemId: 'pages',
      title: 'Pages and content',
      systemHint:
        "Write real copy for every page (no lorem, no QuickXBuild Ecommerce). Home MUST be src/pages/Index.tsx. Use Tailwind. When the user's request spells out copy, sections, or colors, use them verbatim — they override every hint here.",
      userHint: `Write pages for ${brand}: ${pagePaths.join(', ')}. Tagline: ${blueprint.tagline}. Sections from research: ${blueprint.researchNote || 'hero, features, CTA'}.`,
      focusPaths: pagePaths,
      maxSteps: 12,
    },
    {
      id: 'seo',
      planItemId: 'seo',
      title: 'SEO shell',
      systemHint:
        'Update index.html title and meta description. Optional public/robots.txt. Per-route meta where the template supports it.',
      userHint: `SEO for ${brand}: title="${blueprint.seo.titleTemplate}" description="${blueprint.seo.description}" keywords=${blueprint.seo.keywords.join(', ')}.`,
      focusPaths: ['index.html', 'public/robots.txt'],
      maxSteps: 3,
    }
  )

  return passes
}

/** Detect if writes only touched dependency/starter noise (need forced Index/App/css). */
export function isDependencyOnlyBuild(writtenPaths: string[]): boolean {
  if (writtenPaths.length === 0) return true
  const meaningful = writtenPaths.filter((path) => {
    const p = path.replace(/^\.\//, '')
    if (/package\.json|lock|tsconfig|vite\.config|eslint|biome/i.test(p)) return false
    if (/^server\//i.test(p) && writtenPaths.length === 1) return false
    return /\.(tsx|ts|css|html)$/i.test(p)
  })
  return meaningful.length === 0
}

export function forcedUiPaths(): string[] {
  return ['src/pages/Index.tsx', 'src/App.tsx', 'src/index.css', 'index.html']
}
