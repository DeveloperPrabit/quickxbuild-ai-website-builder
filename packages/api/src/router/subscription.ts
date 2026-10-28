/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * subscription.ts
 * Copyright (C) 2025 Nextify Limited
 */

import { getSubscriptionUsage } from '@quickxbuild/auth/utils/subscription-limits'
import { tryCatch } from '@quickxbuild/common'
import { ensureWorkspaceBilling } from '@quickxbuild/db'
import { TRPCError } from '@trpc/server'
import { createTRPCRouter, organizationProcedure } from '../trpc'

export const subscriptionRouter = createTRPCRouter({
  /** Current resource usage — AI chat remaining comes from workspace_billing.credits_balance. */
  getUsage: organizationProcedure.query(async ({ ctx }) => {
    const orgId = ctx.orgId
    if (!orgId) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Organization ID is missing' })
    }

    const [usage, error] = await tryCatch(async () => {
      const [legacy, billing] = await Promise.all([
        getSubscriptionUsage(orgId),
        ensureWorkspaceBilling(orgId),
      ])

      const creditsBalance = billing.creditsBalance
      const aiNumsLimit = Math.max(legacy.aiNumsLimit, creditsBalance, 10)

      return {
        ...legacy,
        aiNums: creditsBalance,
        aiNumsLimit,
        creditsBalance,
        subscriptionTier: billing.subscriptionTier,
        workspaceType: billing.workspaceType,
        planDetails: {
          free: legacy.planDetails.free
            ? {
                ...legacy.planDetails.free,
                aiNums: creditsBalance,
                aiNumsLimit: Math.max(legacy.planDetails.free.aiNumsLimit, creditsBalance, 10),
              }
            : {
                aiNums: creditsBalance,
                aiNumsLimit,
                seats: legacy.seats,
                seatsLimit: legacy.seatsLimit,
                projectNums: legacy.projectNums,
                projectNumsLimit: legacy.projectNumsLimit,
                plan: billing.subscriptionTier,
                periodEnd: legacy.periodEnd ?? '',
                source: 'CONST' as const,
              },
          paid: legacy.planDetails.paid,
        },
      }
    })

    if (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to retrieve subscription usage information',
      })
    }

    return usage
  }),
})
