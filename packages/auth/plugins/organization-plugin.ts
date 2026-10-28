/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * organization-plugin.ts
 * Copyright (C) 2025 Nextify Limited
 */

import { APIError } from 'better-auth/api'
import { organization } from 'better-auth/plugins'
import {
  assertTierAtLeast,
  BillingGateError,
  ensureWorkspaceBilling,
  markWorkspaceAsTeam,
  SUBSCRIPTION_TIERS,
} from '@quickxbuild/db'
import { sendOrganizationInvitation } from '../utils/email-service'
import { getActiveOrganization } from '../utils/organization-utils'
import { getSubscription } from '../utils/subscription-utils'

export const organizationPlugin = organization({
  async sendInvitationEmail(data: any) {
    const inviteLink = `${process.env.NEXT_PUBLIC_APP_URL}/accept-invitation/${data.id}`
    sendOrganizationInvitation({
      email: data.email,
      invitedByUsername: data.inviter.user.name,
      invitedByEmail: data.inviter.user.email,
      teamName: data.organization.name,
      inviteLink,
    })
  },
  organizationHooks: {
    beforeCreateInvitation: async ({ invitation }) => {
      try {
        await assertTierAtLeast(invitation.organizationId, SUBSCRIPTION_TIERS.BUSINESS, 'team')
      } catch (error) {
        if (error instanceof BillingGateError) {
          throw new APIError('FORBIDDEN', { message: error.message })
        }
        throw error
      }
    },
    afterCreateInvitation: async ({ invitation }) => {
      try {
        await markWorkspaceAsTeam(invitation.organizationId)
      } catch (error) {
        console.error(
          `Failed to mark workspace as TEAM for org ${invitation.organizationId}:`,
          error
        )
      }
    },
  },
  organizationCreation: {
    disabled: false,
    afterCreate: async ({ organization: org }) => {
      try {
        await ensureWorkspaceBilling(org.id, {
          creditsBalance: 10,
          subscriptionTier: SUBSCRIPTION_TIERS.FREE,
          workspaceType: 'PERSONAL',
        })
      } catch (error) {
        console.error(`Failed to seed workspace_billing for org ${org.id}:`, error)
      }

      // Always seed FREE quota even when Stripe customer creation is unavailable
      try {
        const { createOrUpdateSubscriptionLimit, PLAN_TYPES } = await import(
          '../utils/subscription-limits'
        )
        const now = new Date()
        const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
        await createOrUpdateSubscriptionLimit(
          org.id,
          null,
          PLAN_TYPES.FREE,
          now,
          periodEnd,
          undefined,
          'month'
        )
      } catch (error) {
        console.error(`Failed to seed FREE subscription_limit for org ${org.id}:`, error)
      }
    },
  },
  allowUserToCreateOrganization: async (user) => {
    // First org creation is always allowed; additional orgs require BUSINESS+.
    try {
      const active = await getActiveOrganization(user.id)
      if (!active?.id) {
        return true
      }
      await assertTierAtLeast(active.id, SUBSCRIPTION_TIERS.BUSINESS, 'team')
      return true
    } catch (error) {
      if (error instanceof BillingGateError) {
        return false
      }
      const subscription = await getSubscription(user.id)
      return (
        subscription.plan !== 'FREE' &&
        !String(subscription.plan).toLowerCase().includes('free')
      )
    }
  },
})
