import { describe, expect, test } from 'vitest'
import { grossMargin, lineMargin, marginPercent, orderRevenue } from './math'

describe('shop math', () => {
  test('uses integer minor units only', () => {
    expect(lineMargin(1999, 800, 2)).toBe(2398)
    expect(orderRevenue([{ price: 1999, cost: 800, qty: 1 }], 100, 50)).toBe(2049)
    expect(grossMargin(2049, 800)).toBe(1249)
    expect(marginPercent(2000, 500)).toBe(75)
    expect(() => lineMargin(19.99, 8, 1)).toThrow(/integer/)
  })
})
