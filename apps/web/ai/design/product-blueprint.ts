/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * product-blueprint.ts — Prompt analyzer for full product builds
 */

import { z } from 'zod/v4'
import { type CompletenessItem, isFullProductBuild } from './completeness'
import { extractPromptColors, extractPromptPages, type PromptPage } from './prompt-pages'
import type { DesignSpec } from './spec'

/** Page required by a product blueprint. */
export type BlueprintPage = z.infer<typeof BlueprintPage>
/** Page required by a product blueprint. */
export const BlueprintPage = z.object({
  path: z.string(),
  title: z.string(),
  purpose: z.string(),
  mustHaveSections: z.array(z.string()).default([]),
})

/** SEO fields for the product. */
export type BlueprintSeo = z.infer<typeof BlueprintSeo>
/** SEO fields for the product. */
export const BlueprintSeo = z.object({
  titleTemplate: z.string(),
  description: z.string(),
  keywords: z.array(z.string()).default([]),
})

/** Backend scope inferred from the prompt. */
export type BlueprintBackend = z.infer<typeof BlueprintBackend>
/** Backend scope inferred from the prompt. */
export const BlueprintBackend = z.object({
  auth: z.boolean().default(false),
  forms: z.boolean().default(false),
  tables: z.array(z.string()).default([]),
})

/** Asset generation needs. */
export type BlueprintAssets = z.infer<typeof BlueprintAssets>
/** Asset generation needs. */
export const BlueprintAssets = z.object({
  logo: z.boolean().default(true),
  heroImages: z.number().int().min(0).max(6).default(1),
})

/** Build-plan checklist item streamed to the UI. */
export type BuildPlanItem = z.infer<typeof BuildPlanItem>
/** Build-plan checklist item streamed to the UI. */
export const BuildPlanItem = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(['pending', 'running', 'done', 'failed']).default('pending'),
})

/** Structured product brief from prompt analysis. */
export type ProductBlueprint = z.infer<typeof ProductBlueprint>
/** Structured product brief from prompt analysis. */
export const ProductBlueprint = z.object({
  brandName: z.string(),
  tagline: z.string().default(''),
  vertical: z.string(),
  tone: z.string().default('professional'),
  colorHints: z.object({
    background: z.string(),
    foreground: z.string(),
    accent: z.string(),
  }),
  pages: z.array(BlueprintPage),
  seo: BlueprintSeo,
  backend: BlueprintBackend,
  assets: BlueprintAssets,
  animations: z.enum(['none', 'subtle', 'medium']).default('subtle'),
  packagesToInstall: z.array(z.string()).default([]),
  terminalSteps: z.array(z.string()).default([]),
  researchNote: z.string().optional(),
})

/** Site research brief for full builds. */
export type SiteResearch = z.infer<typeof SiteResearch>
/** Site research brief for full builds. */
export const SiteResearch = z.object({
  audience: z.string(),
  sectionIdeas: z.array(z.string()),
  seoKeywords: z.array(z.string()),
  competitorPatterns: z.array(z.string()).default([]),
})

function titleCase(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function extractBrandName(prompt: string): string {
  // Prefer explicit named/called before generic "for …" (avoids "for gym named").
  // Quoted names first so "brand named \"Insane Barber\"" yields the quoted name, not "d".
  const explicit =
    prompt.match(/\b(?:named|called|brand\s+name)\s*[:\-]?\s*["“']([^"”'\n]{2,48})["”']/i) ||
    prompt.match(/\b(?:named|called)\s*[:\-]?\s*([A-Za-z0-9][A-Za-z0-9 &._-]{1,48})/i) ||
    prompt.match(/\bbrand(?:\s+name)?\s*:\s*["']?([A-Za-z0-9][A-Za-z0-9 &._-]{1,48})["']?/i) ||
    prompt.match(/\bgym\s+(?:named|called)\s+([A-Za-z0-9][A-Za-z0-9 &._-]{1,40})/i) ||
    prompt.match(/\b([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+){0,3})\s+(?:gym|fitness|studio)/i) ||
    prompt.match(
      /\bfor\s+["']([A-Za-z0-9][A-Za-z0-9 &._-]{1,48})["']/i
    )
  if (explicit?.[1]) {
    const raw = explicit[1].replace(/[.,!?]+$/, '').trim()
    // Drop leading vertical words accidentally captured ("gym PeakFit" → PeakFit).
    const cleaned = raw.replace(/^(gym|fitness|studio|travel|restaurant)\s+/i, '').trim() || raw
    return titleCase(cleaned)
  }
  return 'My App'
}

const VERTICAL_SIGNALS: [string, RegExp][] = [
  ['gym', /\b(gym|fitness|workout|crossfit|training studio)\b/g],
  ['travel', /\b(destinations?|travel|trek|trekking|tours?|itinerar(?:y|ies))\b/g],
  ['restaurant', /\b(restaurant|cafe|bistro|eatery)\b/g],
  ['agency', /\b(agency|consulting|consultancy)\b/g],
  ['portfolio', /\b(portfolio|photographer)\b/g],
  ['ecommerce', /\b(shop|catalog|storefront|ecommerce|e-commerce|clothing)\b/g],
  ['saas', /\b(saas|dashboard|analytics)\b/g],
]

/** Long briefs mention incidental words (a "shop" in the copy, a city name), so need repeats. */
const LONG_BRIEF_CHARS = 400

function detectVertical(text: string): string {
  const minHits = text.length > LONG_BRIEF_CHARS ? 2 : 1
  let best = 'marketing'
  let bestHits = 0
  for (const [vertical, pattern] of VERTICAL_SIGNALS) {
    const hits = text.match(pattern)?.length ?? 0
    if (hits >= minHits && hits > bestHits) {
      best = vertical
      bestHits = hits
    }
  }
  return best
}

function pageFromPrompt(page: PromptPage, brandName: string): BlueprintPage {
  return {
    path: page.path,
    title: page.title,
    purpose:
      page.path === '/'
        ? `${brandName} homepage exactly as described in the user's brief`
        : `${page.title} page exactly as described in the user's brief`,
    mustHaveSections: [],
  }
}

function pagesForVertical(vertical: string, brandName: string): BlueprintPage[] {
  const home: BlueprintPage = {
    path: '/',
    title: 'Home',
    purpose: `${brandName} homepage with hero, value props, and CTAs`,
    mustHaveSections: ['hero', 'features', 'cta'],
  }
  switch (vertical) {
    case 'gym':
      return [
        home,
        {
          path: '/about',
          title: 'About',
          purpose: 'Story, trainers, facility',
          mustHaveSections: ['story', 'team'],
        },
        {
          path: '/classes',
          title: 'Classes',
          purpose: 'Class schedule and offerings',
          mustHaveSections: ['grid', 'details'],
        },
        {
          path: '/pricing',
          title: 'Pricing',
          purpose: 'Membership plans',
          mustHaveSections: ['plans', 'cta'],
        },
        {
          path: '/contact',
          title: 'Contact',
          purpose: 'Contact form and location',
          mustHaveSections: ['form', 'map'],
        },
        {
          path: '/login',
          title: 'Login',
          purpose: 'Member login',
          mustHaveSections: ['form'],
        },
        {
          path: '/signup',
          title: 'Signup',
          purpose: 'Member signup',
          mustHaveSections: ['form'],
        },
      ]
    case 'travel':
      return [
        home,
        {
          path: '/destinations',
          title: 'Destinations',
          purpose: 'Destination grid',
          mustHaveSections: ['grid'],
        },
        {
          path: '/packages',
          title: 'Packages',
          purpose: 'Tour packages',
          mustHaveSections: ['cards'],
        },
        {
          path: '/about',
          title: 'About',
          purpose: 'Agency story',
          mustHaveSections: ['story'],
        },
        {
          path: '/contact',
          title: 'Contact',
          purpose: 'Inquiry form',
          mustHaveSections: ['form'],
        },
        {
          path: '/login',
          title: 'Login',
          purpose: 'Login',
          mustHaveSections: ['form'],
        },
        {
          path: '/signup',
          title: 'Signup',
          purpose: 'Signup',
          mustHaveSections: ['form'],
        },
      ]
    case 'restaurant':
      return [
        home,
        {
          path: '/menu',
          title: 'Menu',
          purpose: 'Food menu',
          mustHaveSections: ['categories'],
        },
        {
          path: '/about',
          title: 'About',
          purpose: 'Restaurant story',
          mustHaveSections: ['story'],
        },
        {
          path: '/contact',
          title: 'Contact',
          purpose: 'Reservations / contact',
          mustHaveSections: ['form'],
        },
      ]
    case 'ecommerce':
      return [
        home,
        {
          path: '/shop',
          title: 'Shop',
          purpose: 'Product catalog',
          mustHaveSections: ['grid'],
        },
        {
          path: '/about',
          title: 'About',
          purpose: 'Brand story',
          mustHaveSections: ['story'],
        },
        {
          path: '/contact',
          title: 'Contact',
          purpose: 'Support',
          mustHaveSections: ['form'],
        },
        {
          path: '/login',
          title: 'Login',
          purpose: 'Login',
          mustHaveSections: ['form'],
        },
        {
          path: '/signup',
          title: 'Signup',
          purpose: 'Signup',
          mustHaveSections: ['form'],
        },
      ]
    default:
      return [
        home,
        {
          path: '/about',
          title: 'About',
          purpose: 'About the brand',
          mustHaveSections: ['story'],
        },
        {
          path: '/contact',
          title: 'Contact',
          purpose: 'Contact form',
          mustHaveSections: ['form'],
        },
      ]
  }
}

function colorsForVertical(vertical: string, text: string): ProductBlueprint['colorHints'] {
  if (text.includes('cream') || text.includes('beige')) {
    return { background: '#F6F1E7', foreground: '#171717', accent: '#111111' }
  }
  if (vertical === 'gym') {
    return { background: '#0B0B0C', foreground: '#F5F5F5', accent: '#E8FF47' }
  }
  if (vertical === 'travel') {
    return { background: '#F7F4EF', foreground: '#0C2340', accent: '#C45C26' }
  }
  if (vertical === 'restaurant') {
    return { background: '#FAF7F2', foreground: '#1A120B', accent: '#8B1E1E' }
  }
  return { background: '#FFFFFF', foreground: '#171717', accent: '#2563EB' }
}

/**
 * Deterministic prompt → ProductBlueprint (no LLM).
 * Returns null when the prompt is not a full product build.
 */
export function analyzeProductBlueprint(
  prompt: string,
  options: { hasDesign?: boolean; force?: boolean } = {}
): ProductBlueprint | null {
  if (!options.force && !isFullProductBuild(prompt, options.hasDesign)) {
    return null
  }

  const text = prompt.toLowerCase()
  const brandName = extractBrandName(prompt)
  const vertical = detectVertical(text)
  const promptPages = extractPromptPages(prompt)
  const explicitAuth = /\b(login|signup|sign up|auth|register|member|dashboard)\b/.test(text)
  // When the user listed their pages, only add auth if they asked for it.
  const wantsAuth =
    explicitAuth ||
    (promptPages.length === 0 &&
      (vertical === 'gym' || vertical === 'travel' || vertical === 'ecommerce'))
  const wantsForms = /\b(contact|form|booking|inquiry|lead)\b/.test(text) || true
  const pages =
    promptPages.length > 0
      ? promptPages.map((page) => pageFromPrompt(page, brandName))
      : pagesForVertical(vertical, brandName)
  const colorHints = { ...colorsForVertical(vertical, text), ...extractPromptColors(prompt) }
  const tagline =
    vertical === 'gym'
      ? 'Train harder. Live stronger.'
      : vertical === 'travel'
        ? 'Authentic journeys worth taking'
        : `Welcome to ${brandName}`

  return {
    brandName,
    tagline,
    vertical,
    tone: vertical === 'gym' ? 'bold, energetic' : 'warm, trustworthy',
    colorHints,
    pages,
    seo: {
      titleTemplate: `${brandName} | ${titleCase(vertical)}`,
      description: `${brandName} — ${tagline}. Production-ready ${vertical} website.`,
      keywords: [brandName.toLowerCase(), vertical, ...pages.map((p) => p.title.toLowerCase())],
    },
    backend: {
      auth: wantsAuth,
      forms: wantsForms,
      tables: wantsAuth
        ? ['users', 'sessions', ...(wantsForms ? ['inquiries'] : [])]
        : wantsForms
          ? ['inquiries']
          : [],
    },
    assets: {
      logo: true,
      heroImages: vertical === 'travel' || vertical === 'gym' ? 2 : 1,
    },
    animations: 'subtle',
    packagesToInstall: [],
    terminalSteps: ['bun install', 'bun run build'],
  }
}

/** Build a lightweight site research brief from blueprint + prompt. */
export function buildSiteResearch(prompt: string, blueprint: ProductBlueprint): SiteResearch {
  const vertical = blueprint.vertical
  const audience =
    vertical === 'gym'
      ? 'Local fitness seekers, beginners to advanced athletes looking for memberships and classes'
      : vertical === 'travel'
        ? 'Travelers researching destinations, packages, and bookings'
        : `People evaluating ${blueprint.brandName}`

  const sectionIdeas =
    vertical === 'gym'
      ? [
          'Hero with gym atmosphere photo',
          'Featured classes grid',
          'Membership pricing cards',
          'Trainer / about strip',
          'Testimonials',
          'Contact / join CTA',
        ]
      : vertical === 'travel'
        ? [
            'Full-bleed destination hero',
            'Featured destinations',
            'Tour packages',
            'Why-us trust strip',
            'Contact / plan a trip',
          ]
        : ['Hero', 'Features', 'Social proof', 'CTA']

  return {
    audience,
    sectionIdeas,
    seoKeywords: blueprint.seo.keywords,
    competitorPatterns: [
      'Sticky header with brand logo + primary CTA',
      'Mobile hamburger nav',
      'Clear SEO title and meta description',
    ],
  }
}

/** Convert blueprint pages into CompletenessItem list (plus App shell). */
export function blueprintToCompleteness(blueprint: ProductBlueprint): CompletenessItem[] {
  const items: CompletenessItem[] = [
    {
      id: 'shell',
      path: 'src/App.tsx',
      title: 'App shell routes and nav to every page',
      kind: 'shell',
    },
    {
      id: 'seo-html',
      path: 'index.html',
      title: `SEO title/meta for ${blueprint.brandName}`,
      kind: 'shell',
    },
    {
      id: 'design-css',
      path: 'src/index.css',
      title: 'Design tokens and global styles',
      kind: 'shell',
    },
  ]

  for (const page of blueprint.pages) {
    const kind =
      page.path === '/login' || page.path === '/signup'
        ? 'auth'
        : page.path === '/dashboard' || page.path === '/admin' || page.path === '/shop'
          ? 'app'
          : 'marketing'
    items.push({
      id: page.path.replace(/\W+/g, '-').replace(/^-+|-+$/g, '') || 'page',
      path: page.path,
      title: `${page.title} — ${page.purpose}`,
      kind,
    })
  }

  return items
}

/** Merge blueprint theme into a DesignSpec. */
export function applyBlueprintToDesignSpec(
  blueprint: ProductBlueprint,
  base?: DesignSpec | null
): DesignSpec {
  const pages = blueprint.pages.map((page) => ({
    name: page.title,
    path: page.path,
    frames: [
      {
        name: page.title,
        role: 'marketing',
        notes: `${page.purpose}. Sections: ${page.mustHaveSections.join(', ') || 'full layout'}`,
      },
    ],
  }))

  return {
    theme: {
      background: blueprint.colorHints.background,
      foreground: blueprint.colorHints.foreground,
      accent: blueprint.colorHints.accent,
      font: base?.theme.font || 'ui-sans-serif',
    },
    pages,
  }
}

/** XML block injected into agent extraContext. */
export function formatProductBlueprintXml(blueprint: ProductBlueprint): string {
  return `<productBlueprint>
${JSON.stringify(blueprint, null, 2)}
</productBlueprint>`
}

/** XML for site research. */
export function formatSiteResearchXml(research: SiteResearch): string {
  return `<siteResearch>
${JSON.stringify(research, null, 2)}
</siteResearch>`
}

/** Visible build plan checklist derived from a blueprint. */
export function buildPlanFromBlueprint(blueprint: ProductBlueprint): BuildPlanItem[] {
  const items: BuildPlanItem[] = [
    {
      id: 'research',
      label: `Research ${blueprint.vertical} site for ${blueprint.brandName}`,
      status: 'pending',
    },
    {
      id: 'backend',
      label: blueprint.backend.auth || blueprint.backend.forms
        ? `Backend: ${[
            blueprint.backend.auth ? 'auth' : null,
            blueprint.backend.forms ? 'forms' : null,
            blueprint.backend.tables.length ? `tables(${blueprint.backend.tables.join(',')})` : null,
          ]
            .filter(Boolean)
            .join(', ')}`
        : 'Backend: optional (skip if UI-only)',
      status: 'pending',
    },
    {
      id: 'scaffold',
      label: `Scaffold: ${blueprint.terminalSteps.join(' → ') || 'bun install → bun run build'}`,
      status: 'pending',
    },
    {
      id: 'design',
      label: 'Design system: CSS tokens, Header/Footer with brand',
      status: 'pending',
    },
    {
      id: 'assets',
      label: blueprint.assets.logo
        ? `Assets: logo${blueprint.assets.heroImages ? ` + ${blueprint.assets.heroImages} hero image(s)` : ''}`
        : 'Assets: optional',
      status: 'pending',
    },
    {
      id: 'shell',
      label: 'App shell: routes in src/App.tsx',
      status: 'pending',
    },
  ]

  for (const page of blueprint.pages) {
    items.push({
      id: `page-${page.path.replace(/\W+/g, '-') || 'home'}`,
      label: `Page ${page.path}: ${page.title}`,
      status: 'pending',
    })
  }

  items.push(
    {
      id: 'seo',
      label: `SEO: ${blueprint.seo.titleTemplate}`,
      status: 'pending',
    },
    {
      id: 'verify',
      label: 'Self-check: install → build → repair → preview',
      status: 'pending',
    }
  )

  if (blueprint.packagesToInstall.length > 0) {
    items.splice(3, 0, {
      id: 'packages',
      label: `Install packages: ${blueprint.packagesToInstall.join(', ')}`,
      status: 'pending',
    })
  }

  return items
}
