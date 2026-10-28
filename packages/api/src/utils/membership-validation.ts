/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * membership-validation.ts
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

import { getSubscriptionUsage } from '@quickxbuild/auth/utils/subscription-limits'
import { PLAN_TYPES } from '@quickxbuild/auth/utils/subscription-limits/types'
import { log } from '@quickxbuild/common'
import {
  assertTierAtLeast,
  BillingGateError,
  ensureWorkspaceBilling,
  getWorkspaceBilling,
  isTierAtLeast,
  mapPlanNameToTier,
  SUBSCRIPTION_TIERS,
  type SubscriptionTier,
} from '@quickxbuild/db'
import { TRPCError } from '@trpc/server'

function billingToTrpc(error: unknown): never {
  if (error instanceof BillingGateError) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: error.message,
    })
  }
  throw error
}

/**
 * Check if user has premium membership (BASIC+ tier)
 */
export async function hasPremiumMembership(organizationId: string): Promise<boolean> {
  try {
    const billing = await ensureWorkspaceBilling(organizationId)
    const isPremium = isTierAtLeast(billing.subscriptionTier, SUBSCRIPTION_TIERS.BASIC)

    log.subscription('info', 'Membership check completed', {
      organizationId,
      tier: billing.subscriptionTier,
      isPremium,
      operation: 'hasPremiumMembership',
    })

    return isPremium
  } catch (error) {
    log.subscription(
      'error',
      'Failed to check membership status',
      {
        organizationId,
        operation: 'hasPremiumMembership',
      },
      error instanceof Error ? error : new Error(String(error))
    )

    return false
  }
}

/**
 * Require premium membership (BASIC+) for a feature
 */
export async function requirePremiumMembership(
  organizationId: string,
  featureName = 'this feature'
): Promise<void> {
  try {
    await assertTierAtLeast(organizationId, SUBSCRIPTION_TIERS.BASIC, 'generic')
  } catch (error) {
    if (error instanceof BillingGateError) {
      log.subscription('warn', 'Premium feature access denied', {
        organizationId,
        featureName,
        operation: 'requirePremiumMembership',
      })
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: error.message.includes('requires')
          ? `Premium membership required to use ${featureName}. Please upgrade your plan to access this feature.`
          : error.message,
      })
    }
    throw error
  }
}

/**
 * Feature access permissions interface
 */
export interface FeaturePermissions {
  canUseCustomDomains: boolean
  canCreateUnlimitedProjects: boolean
  canUseAdvancedAI: boolean
  canInviteMembers: boolean
  canAccessAnalytics: boolean
  canExportProjects: boolean
  canCreatePrivateProjects: boolean
}

/**
 * Extended membership status with detailed feature permissions
 */
export interface MembershipStatus {
  isPremium: boolean
  plan: string
  tier: SubscriptionTier
  workspaceType: string
  creditsBalance: number
  features: FeaturePermissions
  usage: {
    aiNums: number
    aiNumsLimit: number
    projectNums: number
    projectNumsLimit: number
    seats: number
    seatsLimit: number
  }
  periodEnd?: string | undefined
}

/**
 * Feature permissions from workspace billing tier.
 * Custom domains: BASIC+. Team invites: BUSINESS+.
 */
function getFeaturePermissionsForTier(tier: SubscriptionTier): FeaturePermissions {
  const isBasicPlus = isTierAtLeast(tier, SUBSCRIPTION_TIERS.BASIC)
  const isBusinessPlus = isTierAtLeast(tier, SUBSCRIPTION_TIERS.BUSINESS)
  const isAdvanced = tier === SUBSCRIPTION_TIERS.ADVANCED

  return {
    canUseCustomDomains: isBasicPlus,
    canCreateUnlimitedProjects: isAdvanced,
    canUseAdvancedAI: isBasicPlus,
    canInviteMembers: isBusinessPlus,
    canAccessAnalytics: isBasicPlus,
    canExportProjects: isBasicPlus,
    canCreatePrivateProjects: isBasicPlus,
  }
}

/** Legacy plan-name helper; prefer getFeaturePermissionsForTier. */
function getFeaturePermissions(plan: string): FeaturePermissions {
  return getFeaturePermissionsForTier(mapPlanNameToTier(plan))
}

/**
 * Get comprehensive membership status with feature permissions
 */
export async function getMembershipStatus(organizationId: string): Promise<MembershipStatus> {
  try {
    const [usage, billing] = await Promise.all([
      getSubscriptionUsage(organizationId),
      ensureWorkspaceBilling(organizationId),
    ])
    const tier = billing.subscriptionTier
    const isPremium = isTierAtLeast(tier, SUBSCRIPTION_TIERS.BASIC)
    const features = getFeaturePermissionsForTier(tier)

    return {
      isPremium,
      plan: usage.plan,
      tier,
      workspaceType: billing.workspaceType,
      creditsBalance: billing.creditsBalance,
      features,
      usage: {
        aiNums: billing.creditsBalance,
        aiNumsLimit: Math.max(usage.aiNumsLimit, billing.creditsBalance),
        projectNums: usage.projectNums,
        projectNumsLimit: usage.projectNumsLimit,
        seats: usage.seats,
        seatsLimit: usage.seatsLimit,
      },
      periodEnd: usage.planDetails?.paid?.periodEnd,
    }
  } catch (error) {
    log.subscription(
      'error',
      'Failed to get membership status',
      {
        organizationId,
        operation: 'getMembershipStatus',
      },
      error instanceof Error ? error : new Error(String(error))
    )

    return {
      isPremium: false,
      plan: PLAN_TYPES.FREE,
      tier: SUBSCRIPTION_TIERS.FREE,
      workspaceType: 'PERSONAL',
      creditsBalance: 0,
      features: getFeaturePermissionsForTier(SUBSCRIPTION_TIERS.FREE),
      usage: {
        aiNums: 0,
        aiNumsLimit: 50,
        projectNums: 1,
        projectNumsLimit: 1,
        seats: 1,
        seatsLimit: 1,
      },
    }
  }
}

/**
 * Feature-specific validation functions
 */

/**
 * Require custom domain access (BASIC+)
 */
export async function requireCustomDomainAccess(organizationId: string): Promise<void> {
  try {
    await assertTierAtLeast(organizationId, SUBSCRIPTION_TIERS.BASIC, 'custom_domain')
  } catch (error) {
    if (error instanceof BillingGateError) {
      log.subscription('warn', 'Custom domain gate denied', {
        organizationId,
        operation: 'requireCustomDomainAccess',
        code: error.code,
      })
    }
    billingToTrpc(error)
  }
}

/**
 * Require advanced AI features
 */
export async function requireAdvancedAI(organizationId: string): Promise<void> {
  await requirePremiumMembership(organizationId, 'advanced AI features')
}

/**
 * Require member invitation permissions (BUSINESS+)
 */
export async function requireMemberInviteAccess(organizationId: string): Promise<void> {
  try {
    await assertTierAtLeast(organizationId, SUBSCRIPTION_TIERS.BUSINESS, 'team')
  } catch (error) {
    if (error instanceof BillingGateError) {
      log.subscription('warn', 'Team invite gate denied', {
        organizationId,
        operation: 'requireMemberInviteAccess',
        code: error.code,
      })
    }
    billingToTrpc(error)
  }
}

/**
 * Require analytics access
 */
export async function requireAnalyticsAccess(organizationId: string): Promise<void> {
  await requirePremiumMembership(organizationId, 'analytics')
}

/**
 * Require project export permissions
 */
export async function requireProjectExportAccess(organizationId: string): Promise<void> {
  await requirePremiumMembership(organizationId, 'project export')
}

/**
 * Require private project access
 */
export async function requirePrivateProjectAccess(organizationId: string): Promise<void> {
  await requirePremiumMembership(organizationId, 'private projects')
}

/**
 * Check if user can create more projects
 */
export async function canCreateProject(organizationId: string): Promise<boolean> {
  try {
    const usage = await getSubscriptionUsage(organizationId)

    // MAX / ENTERPRISE have unlimited projects
    if (usage.plan === PLAN_TYPES.MAX || usage.plan === PLAN_TYPES.ENTERPRISE) {
      return true
    }

    // Check if user has remaining project quota
    return usage.projectNums > 0
  } catch (error) {
    log.subscription(
      'error',
      'Failed to check project creation permission',
      {
        organizationId,
        operation: 'canCreateProject',
      },
      error instanceof Error ? error : new Error(String(error))
    )

    return false
  }
}

/**
 * Unified feature access checker
 */
export async function hasFeatureAccess(
  organizationId: string,
  feature: keyof FeaturePermissions
): Promise<boolean> {
  try {
    const membershipStatus = await getMembershipStatus(organizationId)
    return membershipStatus.features[feature]
  } catch (error) {
    log.subscription(
      'error',
      'Failed to check feature access',
      {
        organizationId,
        feature,
        operation: 'hasFeatureAccess',
      },
      error instanceof Error ? error : new Error(String(error))
    )

    return false
  }
}

/**
 * Require specific feature access
 */
export async function requireFeatureAccess(
  organizationId: string,
  feature: keyof FeaturePermissions,
  featureName?: string
): Promise<void> {
  const hasAccess = await hasFeatureAccess(organizationId, feature)

  if (!hasAccess) {
    const displayName = featureName || feature.replace(/([A-Z])/g, ' $1').toLowerCase()

    log.subscription('warn', 'Feature access denied', {
      organizationId,
      feature,
      operation: 'requireFeatureAccess',
    })

    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `Premium membership required to use ${displayName}. Please upgrade your plan to access this feature.`,
    })
  }
}
