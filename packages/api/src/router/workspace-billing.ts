/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * workspace-billing.ts
 * Copyright (C) 2025 Nextify Limited
 *
 * Preflight + credit top-up procedures for workspace monetization gates.
 */

import { z } from 'zod/v4'
import { TRPCError } from '@trpc/server'
import { log } from '@quickxbuild/common'
import {
  assertTierAtLeast,
  BillingGateError,
  ensureWorkspaceBilling,
  incrementCredits,
  SUBSCRIPTION_TIERS,
} from '@quickxbuild/db'
import { createTRPCRouter, organizationProcedure } from '../trpc'
import { BILLING_MESSAGES } from '../utils/billing-errors'

export const workspaceBillingRouter = createTRPCRouter({
  /** Current workspace billing snapshot for UI. */
  getStatus: organizationProcedure.query(async ({ ctx }) => {
    const orgId = ctx.orgId
    if (!orgId) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Organization ID is missing' })
    }
    const billing = await ensureWorkspaceBilling(orgId)
    return {
      creditsBalance: billing.creditsBalance,
      subscriptionTier: billing.subscriptionTier,
      workspaceType: billing.workspaceType,
      canUseCustomDomains: ['BASIC', 'BUSINESS', 'ADVANCED'].includes(billing.subscriptionTier),
      canInviteMembers: ['BUSINESS', 'ADVANCED'].includes(billing.subscriptionTier),
    }
  }),

  /** Preflight before inviteMember — UI must call this; server hook still enforces. */
  assertCanInvite: organizationProcedure.mutation(async ({ ctx }) => {
    const orgId = ctx.orgId
    if (!orgId) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Organization ID is missing' })
    }
    try {
      await assertTierAtLeast(orgId, SUBSCRIPTION_TIERS.BUSINESS, 'team')
      log.subscription('info', 'Invite gate allowed', {
        organizationId: orgId,
        operation: 'assertCanInvite',
      })
      return { ok: true as const }
    } catch (error) {
      if (error instanceof BillingGateError) {
        log.subscription('warn', 'Invite gate denied', {
          organizationId: orgId,
          operation: 'assertCanInvite',
          code: error.code,
        })
        throw new TRPCError({ code: 'FORBIDDEN', message: error.message })
      }
      throw error
    }
  }),

  /**
   * Credit pack top-up (called after successful Stripe credit-pack purchase webhook
   * or internal admin tooling). Atomically increments credits_balance.
   */
  incrementCredits: organizationProcedure
    .input(
      z.object({
        amount: z.number().int().positive().max(100_000),
        /** Optional idempotency key for future webhook dedupe. */
        stripeEventId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.orgId
      if (!orgId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Organization ID is missing' })
      }
      // Restrict to org owners/admins via existing organizationProcedure membership.
      const result = await incrementCredits(orgId, input.amount)
      log.subscription('info', 'Credits topped up', {
        organizationId: orgId,
        amount: input.amount,
        creditsBalance: result.creditsBalance,
        stripeEventId: input.stripeEventId,
        operation: 'incrementCredits',
      })
      return result
    }),

  /** Expose product gate messages for clients. */
  getGateMessages: organizationProcedure.query(() => BILLING_MESSAGES),
})
