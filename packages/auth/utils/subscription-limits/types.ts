/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * types.ts
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

 // Unified plan type constants to avoid magic strings
export const PLAN_TYPES = {
  FREE: 'quickxbuild free',
  PRO: 'quickxbuild pro',
  BUSINESS: 'quickxbuild business',
  MAX: 'quickxbuild max',
  ENTERPRISE: 'quickxbuild enterprise',
} as const

export type PlanType = typeof PLAN_TYPES[keyof typeof PLAN_TYPES]

/** Built-in limits when D1 `plan` rows are missing (local / first boot). */
export const CONST_PLAN_LIMITS: Record<PlanType, PlanLimits> = {
  [PLAN_TYPES.FREE]: { aiNums: 10, seats: 1, projectNums: 1 },
  [PLAN_TYPES.PRO]: { aiNums: 100, seats: 1, projectNums: 3 },
  [PLAN_TYPES.BUSINESS]: { aiNums: 2000, seats: 25, projectNums: 50 },
  [PLAN_TYPES.MAX]: { aiNums: 500, seats: 20, projectNums: 20 },
  [PLAN_TYPES.ENTERPRISE]: { aiNums: 99999, seats: 99999, projectNums: 99999 },
}

 // Plan limits interface definition
export interface PlanLimits {
  aiNums: number
  seats: number
  projectNums: number
  uploadLimit?: number
  deployLimit?: number
}

 // Subscription limit record interface
export interface SubscriptionLimitRecord {
  id: string
  organizationId: string
  planName: string
  planId: string
  aiNums: number
  enhanceNums: number
  uploadLimit: number
  deployLimit: number
  seats: number
  projectNums: number
  isActive: boolean
  periodStart: string
  periodEnd: string
  stripeCustomerId: string | null
  createdAt: string | null
  updatedAt: string
}

 // Plan details interface
export interface PlanDetails {
  aiNums: number
  aiNumsLimit: number
  seats: number
  seatsLimit: number
  projectNums: number
  projectNumsLimit: number
  plan: string
  periodEnd: string
  source: 'DB' | 'CONST' // Indicates data source
}

 // Usage return interface
export interface SubscriptionUsage {
  aiNums: number
  aiNumsLimit: number
  seats: number
  seatsLimit: number
  projectNums: number
  projectNumsLimit: number
  plan: string
  periodEnd?: string
  planDetails: {
    free: PlanDetails | null
    paid: PlanDetails | null
  }
}