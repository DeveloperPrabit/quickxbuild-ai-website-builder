import { describe, expect, it } from 'vitest'
import {
  classifyAiCreditCost,
  isTierAtLeast,
  mapPlanNameToTier,
  BILLING_MESSAGES,
} from '../workspace-billing'

describe('classifyAiCreditCost', () => {
  it('charges 1 for ordinary UI edits', () => {
    expect(classifyAiCreditCost('add a save button')).toBe(1)
    expect(classifyAiCreditCost('fix the shop page', true)).toBe(1)
  })

  it('charges 5 for schema/database fullstack prompts', () => {
    expect(classifyAiCreditCost('add drizzle schema and postgres migration')).toBe(5)
    expect(classifyAiCreditCost('create table products in the database')).toBe(5)
    expect(classifyAiCreditCost('update SQL migration for inventory')).toBe(5)
  })
})

describe('mapPlanNameToTier', () => {
  it('maps legacy QuickXBuild plan names', () => {
    expect(mapPlanNameToTier('quickxbuild free')).toBe('FREE')
    expect(mapPlanNameToTier('quickxbuild pro')).toBe('BASIC')
    expect(mapPlanNameToTier('quickxbuild max')).toBe('ADVANCED')
    expect(mapPlanNameToTier('business')).toBe('BUSINESS')
  })
})

describe('isTierAtLeast', () => {
  it('compares tiers correctly', () => {
    expect(isTierAtLeast('BASIC', 'BASIC')).toBe(true)
    expect(isTierAtLeast('FREE', 'BASIC')).toBe(false)
    expect(isTierAtLeast('BUSINESS', 'BASIC')).toBe(true)
    expect(isTierAtLeast('ADVANCED', 'BUSINESS')).toBe(true)
  })
})

describe('BILLING_MESSAGES', () => {
  it('keeps exact product copy', () => {
    expect(BILLING_MESSAGES.INSUFFICIENT_CREDITS).toContain('Insufficient credits')
    expect(BILLING_MESSAGES.CUSTOM_DOMAIN).toContain('Basic Plan ($30/mo)')
    expect(BILLING_MESSAGES.TEAM_WORKSPACE).toContain('Business Plan ($50/mo)')
  })
})
