/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * stripe-utils.ts
 * Copyright (C) 2025 Nextify Limited
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 */

/**
 * Get application URL with optional path
 */
export const getURL = (path?: string) => {
  let url =
    process.env.NEXT_PUBLIC_APP_URL ?? // Configured URL
    'http://localhost:3000/' // Default development URL

  // Ensure URL doesn't end with a slash
  url = url.charAt(url.length - 1) === '/' ? url : `${url}/`

  // If path is provided, add it to URL
  if (path) {
    // Ensure path doesn't start with a slash
    const cleanPath = path.startsWith('/') ? path.substring(1) : path
    url = `${url}${cleanPath}`
  }

  return url
}

/**
 * Parse plan limits from metadata
 */
const parsePlanLimits = (limits: any) => {
  let metadata: {
    features?: string[]
    project_nums?: string
    ai_nums?: string
    seats?: string | number
  } = {}

  if (limits) {
    try {
      if (typeof limits === 'object' && limits !== null) {
        metadata = limits
      } else if (typeof limits === 'string') {
        metadata = JSON.parse(limits)
      }
    } catch (e) {
      // Failed to parse plan limits - use empty metadata
    }
  }

  return metadata
}

/**
 * Parse marketing features from plan data
 */
const parseMarketingFeatures = (marketingFeatures: any): string[] => {
  if (Array.isArray(marketingFeatures)) {
    return marketingFeatures
  }

  if (typeof marketingFeatures === 'string') {
    try {
      const parsed = JSON.parse(marketingFeatures)
      return Array.isArray(parsed) ? parsed : []
    } catch (e) {
      // Failed to parse marketing features - use empty array
    }
  }

  return []
}

/**
 * Get plan configuration based on plan name
 */
const getPlanConfig = (planName: string) => {
  const planNameLower = planName.toLowerCase()

  if (planNameLower.includes('free')) {
    return {
      group: 'free',
      icon: '',
      variant: 'glow',
      ctaLabel: 'Get started for free',
      ctaHref: '/docs/getting-started/introduction',
    }
  }

  if (planNameLower.includes('pro')) {
    return {
      group: 'team',
      icon: 'user',
      variant: 'glow-brand',
      ctaLabel: 'Get Pro Plan',
      ctaHref: '#',
    }
  }

  if (planNameLower.includes('business')) {
    return {
      group: 'team',
      icon: 'users',
      variant: 'glow-brand',
      ctaLabel: 'Get Business Plan',
      ctaHref: '#',
    }
  }

  if (planNameLower.includes('max') || planNameLower.includes('enterprise')) {
    return {
      group: 'enterprise',
      icon: 'users',
      variant: 'glow',
      ctaLabel: planNameLower.includes('enterprise') ? 'Contact sales' : 'Get Max Plan',
      ctaHref: planNameLower.includes('enterprise') ? '/contact' : '#',
    }
  }

  return {
    group: 'other',
    icon: '',
    variant: 'default',
    ctaLabel: 'Get started',
    ctaHref: '#',
  }
}

/**
 * Map database plans and prices data to frontend-friendly format
 */
export function mapToPlans(productPrices: any[], currentUserPlan?: string | null): any[] {
  const plansMap = new Map()

  for (const item of productPrices) {
    if (!item.plan?.id) continue

    const planId = item.plan.id

    if (!plansMap.has(planId)) {
      const metadata = parsePlanLimits(item.plan.limits)
      const marketingFeatures = parseMarketingFeatures(item.plan.marketing_features)
      const planConfig = getPlanConfig(item.plan.name || '')

      // Build features array
      const features = Array.isArray(metadata.features) ? [...metadata.features] : []
      if (metadata.project_nums) {
        features.push(`Up to ${metadata.project_nums} projects`)
      }
      if (metadata.ai_nums) {
        features.push(`${metadata.ai_nums} AI messages per month`)
      }

      // Determine seats limit
      const seatsLimit =
        typeof metadata.seats === 'number'
          ? metadata.seats
          : Number.parseInt(metadata.seats as string, 10) || 1

      // Check if it's the user's primary plan
      // Only the primary plan (usually a paid plan) is displayed as the current plan
      const isCurrentPlan =
        currentUserPlan &&
        (item.plan.name === currentUserPlan ||
          item.plan.name?.toLowerCase() === currentUserPlan.toLowerCase())

      plansMap.set(planId, {
        id: item.plan.id,
        name: item.plan.name,
        group: planConfig.group,
        description: item.plan.description || '',
        features,
        marketingFeatures,
        prices: [],
        icon: planConfig.icon,
        variant: planConfig.variant,
        seats: seatsLimit,
        cta: {
          variant: 'default',
          label: planConfig.ctaLabel,
          href: planConfig.ctaHref,
        },
        monthlyPrice: 0,
        yearlyPrice: 0,
        isCurrentPlan: isCurrentPlan || false,
      })
    }

    const planData = plansMap.get(planId)

    // Add price information
    if (item.price?.priceId) {
      const priceInfo = {
        id: item.price.id,
        stripePriceId: item.price.priceId,
        amount: item.price.unitAmount || 0,
        currency: item.price.currency || 'usd',
        interval: item.price.pricingPlanInterval || 'month',
      }

      planData.prices.push(priceInfo)

      // Update plan's monthly or yearly price
      if (priceInfo.interval === 'month') {
        planData.monthlyPrice = priceInfo.amount / 100
      } else if (priceInfo.interval === 'year') {
        planData.yearlyPrice = priceInfo.amount / 100
      }
    }
  }

  // Fill missing prices and handle free plans
  for (const planData of plansMap.values()) {
    if (planData.monthlyPrice === 0 && planData.yearlyPrice > 0) {
      planData.monthlyPrice = Math.round(planData.yearlyPrice / 12)
    } else if (planData.yearlyPrice === 0 && planData.monthlyPrice > 0) {
      planData.yearlyPrice = Math.round(planData.monthlyPrice * 12 * 0.8) // 20% discount
    }

    // Ensure free plans have zero prices
    if (planData.name?.toLowerCase().includes('free')) {
      planData.monthlyPrice = 0
      planData.yearlyPrice = 0
    }
  }

  // Drop local remnant free/max stubs from marketing & billing plan lists
  const plansArray = Array.from(plansMap.values()).filter((planData) => {
    const name = (planData.name || '').toLowerCase().trim()
    const desc = (planData.description || '').toLowerCase()
    if (desc.includes('local free development') || desc.includes('local enterprise development')) {
      return false
    }
    if (desc.includes('local development plan')) {
      return false
    }
    if (
      (name === 'quickxbuild free' || name === 'quickxbuild max') &&
      (desc.includes('local') || desc.includes('development plan'))
    ) {
      return false
    }
    return true
  })

  plansArray.sort((a, b) => {
    const aIsFree = a.name?.toLowerCase().includes('free')
    const bIsFree = b.name?.toLowerCase().includes('free')

    if (aIsFree && !bIsFree) return -1
    if (!aIsFree && bIsFree) return 1

    return a.monthlyPrice - b.monthlyPrice
  })

  return plansArray
}

/**
 * Default subscription limits for free users
 */
export const DEFAULT_FREE_LIMITS = {
  aiNums: 0,
  aiNumsLimit: 10,
  seats: 0,
  seatsLimit: 1,
  projectNums: 0,
  projectNumsLimit: 1,
  plan: 'FREE',
  isActive: false,
}

/** Catalog used when D1 `plan`/`price` tables are empty (first deploy / no Stripe sync). */
export function getDefaultPlanCatalog(): Array<{
  plan: {
    id: string
    name: string
    group: string | null
    limits: string
    marketing_features: string
    isActive: boolean
    description: string | null
  }
  price: {
    id: string
    priceId: string | null
    planId: string
    unitAmount: number
    currency: string
    pricingPlanInterval: string
  } | null
}> {
  const catalog = [
    {
      id: 'plan_free',
      name: 'quickxbuild free',
      group: 'free',
      description: 'Start building with QuickXBuild for free',
      limits: JSON.stringify({ ai_nums: '10', seats: '1', project_nums: '1' }),
      features: [
        'Up to 1 project',
        '10 AI messages / month',
        'Community support',
      ],
      month: 0,
      year: 0,
    },
    {
      id: 'plan_pro',
      name: 'quickxbuild pro',
      group: 'team',
      description: 'Custom domains and more AI credits',
      limits: JSON.stringify({ ai_nums: '100', seats: '1', project_nums: '3' }),
      features: [
        'Up to 3 projects',
        '100 AI messages / month',
        'Custom domains',
        'Email support',
      ],
      month: 3000,
      year: 28800,
    },
    {
      id: 'plan_business',
      name: 'quickxbuild business',
      group: 'team',
      description: 'Scale with AI cloud database, SEO, SSO, and team collaboration',
      limits: JSON.stringify({ ai_nums: '2000', seats: '25', project_nums: '50' }),
      features: [
        'Up to 50 projects',
        '2000 AI messages / month',
        'AI cloud database',
        'SEO optimization tools',
        'Single Sign-On (SSO)',
        'Custom domains',
        'Team invites (25 seats)',
        'Priority support',
        'Advanced analytics',
        'GitHub auto-commit',
      ],
      month: 19900,
      year: 191040,
    },
  ]

  const rows: ReturnType<typeof getDefaultPlanCatalog> = []
  for (const item of catalog) {
    const base = {
      id: item.id,
      name: item.name,
      group: item.group,
      limits: item.limits,
      marketing_features: JSON.stringify(item.features),
      isActive: true,
      description: item.description,
    }
    rows.push({
      plan: base,
      price: {
        id: `${item.id}_month`,
        priceId: `price_${item.id}_month`,
        planId: item.id,
        unitAmount: item.month,
        currency: 'usd',
        pricingPlanInterval: 'month',
      },
    })
    if (item.year > 0) {
      rows.push({
        plan: base,
        price: {
          id: `${item.id}_year`,
          priceId: `price_${item.id}_year`,
          planId: item.id,
          unitAmount: item.year,
          currency: 'usd',
          pricingPlanInterval: 'year',
        },
      })
    }
  }
  return rows
}
