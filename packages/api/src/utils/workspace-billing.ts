/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * workspace-billing.ts
 * Copyright (C) 2025 Nextify Limited
 *
 * API-facing re-exports of the workspace billing gate engine.
 * Pure helpers import from the utils module to avoid loading DB env in unit tests.
 */

export {
  assertTierAtLeast,
  classifyAiCreditCost,
  ensureWorkspaceBilling,
  getWorkspaceBilling,
  incrementCredits,
  isTierAtLeast,
  mapPlanNameToTier,
  markWorkspaceAsTeam,
  refundCredits,
  reserveCredits,
  setSubscriptionTier,
  BILLING_ERROR_CODES,
  BILLING_MESSAGES,
  BillingGateError,
  type WorkspaceBillingRow,
} from '../../../db/utils/workspace-billing'

export {
  DEFAULT_TRIAL_CREDITS,
  SUBSCRIPTION_TIERS,
  WORKSPACE_TYPES,
  type SubscriptionTier,
  type WorkspaceType,
} from '../../../db/schema/workspace-billing-schema'
