/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * product-blueprint.test.ts
 */

import { describe, expect, test } from 'vitest'
import {
  analyzeProductBlueprint,
  blueprintToCompleteness,
  buildPlanFromBlueprint,
  buildSiteResearch,
} from '../design/product-blueprint'

describe('product blueprint', () => {
  test('analyzes TheProBuilder gym prompt', () => {
    const bp = analyzeProductBlueprint('make a website for gym named: theprobuilder')
    expect(bp).not.toBeNull()
    expect(bp!.brandName.toLowerCase()).toContain('theprobuilder')
    expect(bp!.vertical).toBe('gym')
    expect(bp!.pages.some((p) => p.path === '/classes')).toBe(true)
    expect(bp!.pages.some((p) => p.path === '/pricing')).toBe(true)
    expect(bp!.assets.logo).toBe(true)
  })

  test('analyzes travel Nepal prompt', () => {
    const bp = analyzeProductBlueprint(
      'Build a complete Nepali travel agency website for TIFF Nepal with destinations and packages'
    )
    expect(bp!.vertical).toBe('travel')
    expect(bp!.pages.some((p) => p.path === '/destinations')).toBe(true)
  })

  test('skips bug-fix prompts', () => {
    expect(analyzeProductBlueprint('fix signup toast request failed')).toBeNull()
  })

  test('completeness includes shell css and index.html', () => {
    const bp = analyzeProductBlueprint('build a gym website named PeakFit')!
    const items = blueprintToCompleteness(bp)
    expect(items.some((i) => i.path === 'src/App.tsx')).toBe(true)
    expect(items.some((i) => i.path === 'index.html')).toBe(true)
    expect(items.some((i) => i.path === 'src/index.css')).toBe(true)
  })

  test('build plan lists backend design pages and verify', () => {
    const bp = analyzeProductBlueprint('create a gym site named IronForge')!
    const plan = buildPlanFromBlueprint(bp)
    expect(plan.some((i) => i.id === 'backend')).toBe(true)
    expect(plan.some((i) => i.id === 'design')).toBe(true)
    expect(plan.some((i) => i.id === 'verify')).toBe(true)
    expect(plan.length).toBeGreaterThan(6)
  })

  test('site research returns audience and sections', () => {
    const bp = analyzeProductBlueprint('build gym website named FlexLab')!
    const research = buildSiteResearch('build gym website named FlexLab', bp)
    expect(research.audience.length).toBeGreaterThan(10)
    expect(research.sectionIdeas.length).toBeGreaterThan(2)
  })
})
