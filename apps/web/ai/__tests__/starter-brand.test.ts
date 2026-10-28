import { describe, expect, it } from 'vitest'
import {
  hasStarterBrand,
  homeNeedsProductRewrite,
  promptWantsEcommerce,
  TEMPLATE_HOME_PATH,
} from '../agent/starter-brand'

describe('starter-brand', () => {
  it('detects ecommerce starter copy', () => {
    expect(hasStarterBrand('Welcome to QuickXBuild Ecommerce')).toBe(true)
    expect(hasStarterBrand('<h1>TIFF Nepal</h1>')).toBe(false)
  })

  it('detects ecommerce prompts', () => {
    expect(promptWantsEcommerce('build a clothing ecommerce store')).toBe(true)
    expect(promptWantsEcommerce('build TIFF Nepal travel website')).toBe(false)
  })

  it('requires Index rewrite when only Home.tsx was written', () => {
    const needs = homeNeedsProductRewrite(
      'Build TIFF Nepal travel website',
      {
        [TEMPLATE_HOME_PATH]: { content: 'Welcome to QuickXBuild Ecommerce' },
      },
      [{ path: 'src/pages/Home.tsx', content: '<h1>TIFF Nepal</h1>' }]
    )
    expect(needs).toBe(true)
  })

  it('accepts a rewritten Index for travel builds', () => {
    const needs = homeNeedsProductRewrite(
      'Build TIFF Nepal travel website',
      { [TEMPLATE_HOME_PATH]: { content: 'Welcome to QuickXBuild Ecommerce' } },
      [{ path: TEMPLATE_HOME_PATH, content: '<h1>TIFF Nepal</h1><p>Himalayas</p>' }]
    )
    expect(needs).toBe(false)
  })
})
