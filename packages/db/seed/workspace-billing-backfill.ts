/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * workspace-billing-backfill.ts
 * Copyright (C) 2025 Nextify Limited
 *
 * Optional Node backfill if SQL migration was applied without data.
 * Prefer the SQL in drizzle/0002_workspace_billing.sql for production.
 */

import { getDbAsync } from '../index'
import { subscriptionLimit } from '../schema/project-schema'
import {
  ensureWorkspaceBilling,
  mapPlanNameToTier,
} from './workspace-billing'
import { sql } from 'drizzle-orm'

export async function backfillWorkspaceBillingFromSubscriptionLimits(): Promise<number> {
  const db = await getDbAsync()
  try {
    const rows = await db
      .select({
        organizationId: subscriptionLimit.organizationId,
        planName: subscriptionLimit.planName,
        aiNums: subscriptionLimit.aiNums,
        isActive: subscriptionLimit.isActive,
        stripeCustomerId: subscriptionLimit.stripeCustomerId,
      })
      .from(subscriptionLimit)

    const byOrg = new Map<
      string,
      { credits: number; plans: string[]; stripeCustomerId: string | null }
    >()

    for (const row of rows) {
      const existing = byOrg.get(row.organizationId) || {
        credits: 0,
        plans: [] as string[],
        stripeCustomerId: null as string | null,
      }
      if (row.isActive) {
        existing.credits += row.aiNums
        existing.plans.push(row.planName)
      }
      if (row.stripeCustomerId) {
        existing.stripeCustomerId = row.stripeCustomerId
      }
      byOrg.set(row.organizationId, existing)
    }

    let count = 0
    for (const [organizationId, data] of byOrg) {
      const paidPlan =
        data.plans.find((p) => !p.toLowerCase().includes('free')) || data.plans[0] || 'quickxbuild free'
      await ensureWorkspaceBilling(organizationId, {
        creditsBalance: Math.max(data.credits, 0),
        subscriptionTier: mapPlanNameToTier(paidPlan),
        stripeCustomerId: data.stripeCustomerId,
      })
      count += 1
    }
    return count
  } finally {
    await (db as { $client?: { end?: () => Promise<void> } }).$client?.end?.()
  }
}

if (import.meta.main) {
  const n = await backfillWorkspaceBillingFromSubscriptionLimits()
  console.log(`Backfilled workspace_billing for ${n} organizations`)
}
