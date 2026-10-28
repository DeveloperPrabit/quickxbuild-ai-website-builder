/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * prompt-pages.ts — Read pages and colors the user spelled out in their own brief
 */

export type PromptPage = { path: string; title: string }

export type PromptColors = {
  background?: string
  foreground?: string
  accent?: string
}

const MAX_PAGES = 12
const PAGE_HEADING = /\bpage\s*\d+\s*[:.\-–—]\s*([A-Za-z][A-Za-z0-9 &'/-]{0,40})/gi
const PAGE_LIST =
  /\b(?:nav(?:igation|bar)?(?:\s+(?:links?|items?|menu))?|pages?|routes?)\s*(?:\([^)\n]*\))?\s*:\s*([^\n.]+)/gi
const LIST_ITEM = /^[A-Za-z][A-Za-z0-9 &'-]{0,30}$/
const HEX = /#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/i

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function toPage(rawTitle: string): PromptPage | null {
  const name = (rawTitle.split(/\s+(?:with|that|for|including|showing|containing)\b/i)[0] ?? '')
    .replace(/\s+page$/i, '')
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .join(' ')
  const title = titleCase(name)
  if (!title) return null
  if (/^(home|homepage|index|landing)$/i.test(title)) {
    return { path: '/', title: 'Home' }
  }
  const slug = title
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug ? { path: `/${slug}`, title } : null
}

function normalize(pages: PromptPage[]): PromptPage[] {
  const unique: PromptPage[] = []
  for (const page of pages) {
    if (!unique.some((existing) => existing.path === page.path)) unique.push(page)
  }
  const home = unique.find((page) => page.path === '/') ?? { path: '/', title: 'Home' }
  return [home, ...unique.filter((page) => page.path !== '/')].slice(0, MAX_PAGES)
}

/**
 * Pages the user listed explicitly ("PAGE 1: HOME PAGE", "Navigation links: Home, About, …",
 * "Pages: Home, Menu, Contact"). Empty when the brief does not name its pages.
 */
export function extractPromptPages(prompt: string): PromptPage[] {
  const headings = [...prompt.matchAll(PAGE_HEADING)]
    .map((match) => toPage(match[1] ?? ''))
    .filter((page): page is PromptPage => page !== null)
  if (headings.length >= 2) return normalize(headings)

  for (const match of prompt.matchAll(PAGE_LIST)) {
    const items = (match[1] ?? '')
      .split(/,|\|| and /i)
      .map((item) => item.trim())
      .filter((item) => LIST_ITEM.test(item) && item.split(/\s+/).length <= 3)
    if (items.length >= 2) {
      return normalize(items.map(toPage).filter((page): page is PromptPage => page !== null))
    }
  }
  return []
}

/** Hex colors the user assigned to background / text / accent roles. */
export function extractPromptColors(prompt: string): PromptColors {
  const colors: PromptColors = {}
  for (const line of prompt.split('\n')) {
    const hex = line.match(HEX)?.[0]
    if (!hex) continue
    const text = line.toLowerCase()
    if (!colors.accent && /\b(accent|brand colou?r|cta|highlight)\b/.test(text)) {
      colors.accent = hex
    } else if (!colors.foreground && /\b(typography|text|foreground|font)\b/.test(text)) {
      colors.foreground = hex
    } else if (!colors.background && /\b(background|bg|base)\b/.test(text)) {
      colors.background = hex
    }
  }
  return colors
}
