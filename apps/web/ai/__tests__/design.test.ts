import { describe, expect, test } from 'vitest'
import { inferCompleteness, writesCoverCompleteness } from '../design/completeness'
import { buildLocalDesignSpec, needsDesignSpec } from '../design/spec'

describe('design spec', () => {
  test('skips file edits and UI-only prompts', () => {
    expect(needsDesignSpec('make the header blue')).toBe(false)
    expect(needsDesignSpec('Generate a Figma design', true)).toBe(false)
  })

  test('treats an attached image as a design source', () => {
    expect(needsDesignSpec('build this', false, true)).toBe(true)
  })

  test('builds a local cream and black storefront spec without a user key', () => {
    expect(needsDesignSpec('modern clothing storefront, cream and black')).toBe(true)
    const spec = buildLocalDesignSpec('modern clothing storefront, cream and black')
    expect(spec.theme.background).toBe('#F6F1E7')
    expect(spec.pages.map((page) => page.path)).toEqual(['/', '/shop'])
  })
})

describe('completeness', () => {
  test('skips checklist for bug fixes so the agent can edit surgically', () => {
    expect(inferCompleteness('fix signup toast request failed')).toEqual([])
    expect(inferCompleteness('login shows 0 and pending is empty')).toEqual([])
  })

  test('does not invent pricing unless the user asked', () => {
    const items = inferCompleteness('build a website with a dashboard')
    expect(items.some((item) => item.path === '/')).toBe(true)
    expect(items.some((item) => item.path === '/dashboard')).toBe(true)
    expect(items.some((item) => item.path === '/pricing')).toBe(false)
  })

  test('requires shop only when commerce is requested', () => {
    const items = inferCompleteness('build a catalog storefront website')
    expect(items.some((item) => item.path === '/shop')).toBe(true)
  })

  test('adds destinations and packages for Nepal travel websites', () => {
    const items = inferCompleteness('create TIFF Nepal travel website with destinations and packages')
    expect(items.some((item) => item.path === '/destinations')).toBe(true)
    expect(items.some((item) => item.path === '/packages')).toBe(true)
    expect(items.some((item) => item.path === '/login')).toBe(true)
    expect(items.some((item) => item.path === 'src/App.tsx')).toBe(true)
  })

  test('adds gym classes pricing and SEO shell for fitness websites', () => {
    const items = inferCompleteness('make a website for gym named TheProBuilder')
    expect(items.some((item) => item.path === '/classes')).toBe(true)
    expect(items.some((item) => item.path === '/pricing')).toBe(true)
    expect(items.some((item) => item.path === 'index.html')).toBe(true)
    expect(items.some((item) => item.path === 'src/index.css')).toBe(true)
  })

  test('detects missing dashboard files on full builds', () => {
    const items = inferCompleteness('build an app with a dashboard')
    const cover = writesCoverCompleteness(['src/pages/Index.tsx', 'src/App.tsx'], items)
    expect(cover.ok).toBe(false)
    expect(cover.missing).toContain('/dashboard')
  })

  test('ignores junk design paths', () => {
    const items = inferCompleteness('build a website', ['.', './', '/login'])
    expect(items.some((item) => item.path === '.' || item.path === './')).toBe(false)
    expect(items.some((item) => item.path === '/login')).toBe(true)
  })
})
