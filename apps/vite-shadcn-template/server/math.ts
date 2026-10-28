export type LineInput = {
  price: number
  cost: number
  qty: number
}

export function assertMinorUnits(value: number, label: string): number {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer minor unit, not a float`)
  }
  return value
}

export function lineRevenue(price: number, qty: number): number {
  return assertMinorUnits(price, 'price') * assertMinorUnits(qty, 'qty')
}

export function lineCogs(cost: number, qty: number): number {
  return assertMinorUnits(cost, 'cost') * assertMinorUnits(qty, 'qty')
}

export function lineMargin(price: number, cost: number, qty: number): number {
  return lineRevenue(price, qty) - lineCogs(cost, qty)
}

export function orderRevenue(lines: LineInput[], tax = 0, discount = 0): number {
  const subtotal = lines.reduce((sum, line) => sum + lineRevenue(line.price, line.qty), 0)
  return subtotal + assertMinorUnits(tax, 'tax') - assertMinorUnits(discount, 'discount')
}

export function orderCogs(lines: LineInput[]): number {
  return lines.reduce((sum, line) => sum + lineCogs(line.cost, line.qty), 0)
}

export function grossMargin(revenue: number, cogs: number): number {
  return assertMinorUnits(revenue, 'revenue') - assertMinorUnits(cogs, 'cogs')
}

export function marginPercent(revenue: number, cogs: number): number {
  if (revenue === 0) {
    return 0
  }
  return Math.round((grossMargin(revenue, cogs) / revenue) * 10000) / 100
}
