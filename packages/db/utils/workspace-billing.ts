/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * workspace-billing.ts
 * Copyright (C) 2025 Nextify Limited
 *
 * Atomic credit reservation and tier gates for multi-tenant monetization.
 */

import { and, eq, gte, sql } from 'drizzle-orm'
import {
  DEFAULT_TRIAL_CREDITS,
  SUBSCRIPTION_TIERS,
  WORKSPACE_TYPES,
  workspaceBilling,
  type SubscriptionTier,
  type WorkspaceType,
} from '../schema/workspace-billing-schema'

async function withDb<T>(
  fn: (db: Awaited<ReturnType<typeof import('../index').getDbAsync>>) => Promise<T>
): Promise<T> {
  const { getDbAsync } = await import('../index')
  const db = await getDbAsync()
  try {
    return await fn(db)
  } finally {
    await (db as { $client?: { end?: () => Promise<void> } }).$client?.end?.()
  }
}

/** Stable billing gate error codes. */
export const BILLING_ERROR_CODES = {
  INSUFFICIENT_CREDITS: 'INSUFFICIENT_CREDITS',
  CUSTOM_DOMAIN_PREMIUM: 'CUSTOM_DOMAIN_PREMIUM',
  TEAM_WORKSPACE_PREMIUM: 'TEAM_WORKSPACE_PREMIUM',
  TIER_REQUIRED: 'TIER_REQUIRED',
} as const

export type BillingErrorCode = (typeof BILLING_ERROR_CODES)[keyof typeof BILLING_ERROR_CODES]

/** Exact user-facing gate messages from the product spec. */
export const BILLING_MESSAGES = {
  INSUFFICIENT_CREDITS:
    'Insufficient credits. Please purchase a plan or top-up your balance to continue building.',
  CUSTOM_DOMAIN:
    'Custom domains are a premium feature. Please upgrade to the Basic Plan ($30/mo) to link your vanity domain name.',
  TEAM_WORKSPACE:
    'Team workspaces are restricted to the Business Plan ($199/mo). Please upgrade to unlock collaboration features.',
} as const

export class BillingGateError extends Error {
  readonly code: BillingErrorCode
  readonly status = 403

  constructor(code: BillingErrorCode, message: string) {
    super(message)
    this.name = 'BillingGateError'
    this.code = code
  }
}

/** Tier rank for comparisons (higher = more features). */
const TIER_RANK: Record<SubscriptionTier, number> = {
  FREE: 0,
  BASIC: 1,
  BUSINESS: 2,
  ADVANCED: 3,
}

/** Schema / DB fullstack prompts cost 5 credits; everything else costs 1. */
const SCHEMA_COST_RE =
  /\b(schema|migration|drizzle|postgres|postgresql|database|sql|create\s+table|alter\s+table|pgtable|supabase|prisma)\b/i

export type WorkspaceBillingRow = {
  organizationId: string
  creditsBalance: number
  subscriptionTier: SubscriptionTier
  workspaceType: WorkspaceType
  stripeCustomerId: string | null
  version: number
}

/** Map legacy plan names (quickxbuild free/pro/max/enterprise) to subscription tiers. */
export function mapPlanNameToTier(planName: string | null | undefined): SubscriptionTier {
  const normalized = (planName || '').toLowerCase()
  if (
    normalized.includes('enterprise') ||
    normalized.includes('max') ||
    normalized.includes('advanced')
  ) {
    return SUBSCRIPTION_TIERS.ADVANCED
  }
  if (normalized.includes('business')) {
    return SUBSCRIPTION_TIERS.BUSINESS
  }
  if (normalized.includes('pro') || normalized.includes('basic')) {
    return SUBSCRIPTION_TIERS.BASIC
  }
  return SUBSCRIPTION_TIERS.FREE
}

export function isTierAtLeast(tier: SubscriptionTier, minTier: SubscriptionTier): boolean {
  return TIER_RANK[tier] >= TIER_RANK[minTier]
}

/**
 * Deterministic credit cost: 5 for schema/DB work, 1 otherwise.
 */
export function classifyAiCreditCost(prompt: string, _isFileEdit = false): 1 | 5 {
  if (SCHEMA_COST_RE.test(prompt)) {
    return 5
  }
  return 1
}

function toRow(row: typeof workspaceBilling.$inferSelect): WorkspaceBillingRow {
  return {
    organizationId: row.organizationId,
    creditsBalance: row.creditsBalance,
    subscriptionTier: row.subscriptionTier as SubscriptionTier,
    workspaceType: row.workspaceType as WorkspaceType,
    stripeCustomerId: row.stripeCustomerId ?? null,
    version: row.version,
  }
}

/** Load billing row or null. */
export async function getWorkspaceBilling(
  organizationId: string
): Promise<WorkspaceBillingRow | null> {
  return withDb(async (db) => {
    const row = await db.query.workspaceBilling.findFirst({
      where: eq(workspaceBilling.organizationId, organizationId),
    })
    return row ? toRow(row) : null
  })
}

/**
 * Ensure a billing row exists (race-safe upsert).
 * Defaults: 10 credits, FREE, PERSONAL.
 */
export async function ensureWorkspaceBilling(
  organizationId: string,
  options?: {
    creditsBalance?: number
    subscriptionTier?: SubscriptionTier
    workspaceType?: WorkspaceType
    stripeCustomerId?: string | null
  }
): Promise<WorkspaceBillingRow> {
  return withDb(async (db) => {
    const credits = options?.creditsBalance ?? DEFAULT_TRIAL_CREDITS
    const tier = options?.subscriptionTier ?? SUBSCRIPTION_TIERS.FREE
    const workspaceType = options?.workspaceType ?? WORKSPACE_TYPES.PERSONAL
    const stripeCustomerId = options?.stripeCustomerId ?? null

    await db
      .insert(workspaceBilling)
      .values({
        organizationId,
        creditsBalance: credits,
        subscriptionTier: tier,
        workspaceType,
        stripeCustomerId,
        version: 0,
      })
      .onConflictDoNothing({ target: workspaceBilling.organizationId })

    const row = await db.query.workspaceBilling.findFirst({
      where: eq(workspaceBilling.organizationId, organizationId),
    })
    if (!row) {
      throw new Error(`Failed to ensure workspace_billing for ${organizationId}`)
    }
    return toRow(row)
  })
}

/**
 * Atomic credit reserve. Returns new balance or throws BillingGateError.
 * Uses UPDATE … WHERE credits_balance >= cost RETURNING.
 */
export async function reserveCredits(
  organizationId: string,
  cost: number
): Promise<{ creditsBalance: number }> {
  if (cost <= 0) {
    throw new Error('Credit cost must be positive')
  }
  await ensureWorkspaceBilling(organizationId)
  return withDb(async (db) => {
    const updated = await db
      .update(workspaceBilling)
      .set({
        creditsBalance: sql`${workspaceBilling.creditsBalance} - ${cost}`,
        version: sql`${workspaceBilling.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(workspaceBilling.organizationId, organizationId),
          gte(workspaceBilling.creditsBalance, cost)
        )
      )
      .returning({ creditsBalance: workspaceBilling.creditsBalance })

    const row = updated[0]
    if (!row) {
      throw new BillingGateError(
        BILLING_ERROR_CODES.INSUFFICIENT_CREDITS,
        BILLING_MESSAGES.INSUFFICIENT_CREDITS
      )
    }
    return { creditsBalance: row.creditsBalance }
  })
}

/** Refund reserved credits after failed/aborted generation. */
export async function refundCredits(organizationId: string, cost: number): Promise<void> {
  if (cost <= 0) {
    return
  }
  await withDb(async (db) => {
    await db
      .update(workspaceBilling)
      .set({
        creditsBalance: sql`${workspaceBilling.creditsBalance} + ${cost}`,
        version: sql`${workspaceBilling.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(eq(workspaceBilling.organizationId, organizationId))
  })
}

/** Atomically add purchased/top-up credits. */
export async function incrementCredits(
  organizationId: string,
  amount: number
): Promise<{ creditsBalance: number }> {
  if (amount <= 0) {
    throw new Error('Top-up amount must be positive')
  }
  await ensureWorkspaceBilling(organizationId)
  return withDb(async (db) => {
    const updated = await db
      .update(workspaceBilling)
      .set({
        creditsBalance: sql`${workspaceBilling.creditsBalance} + ${amount}`,
        version: sql`${workspaceBilling.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(eq(workspaceBilling.organizationId, organizationId))
      .returning({ creditsBalance: workspaceBilling.creditsBalance })

    const row = updated[0]
    if (!row) {
      throw new Error(`Failed to increment credits for ${organizationId}`)
    }
    return { creditsBalance: row.creditsBalance }
  })
}

/** Update subscription tier after Stripe sync. */
export async function setSubscriptionTier(
  organizationId: string,
  tier: SubscriptionTier,
  workspaceType?: WorkspaceType,
  stripeCustomerId?: string | null
): Promise<WorkspaceBillingRow> {
  await ensureWorkspaceBilling(organizationId)
  return withDb(async (db) => {
    const updated = await db
      .update(workspaceBilling)
      .set({
        subscriptionTier: tier,
        ...(workspaceType ? { workspaceType } : {}),
        ...(stripeCustomerId !== undefined ? { stripeCustomerId } : {}),
        version: sql`${workspaceBilling.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(eq(workspaceBilling.organizationId, organizationId))
      .returning()

    const row = updated[0]
    if (!row) {
      throw new Error(`Failed to set tier for ${organizationId}`)
    }
    return toRow(row)
  })
}

/** Mark workspace as TEAM when invites are allowed. */
export async function markWorkspaceAsTeam(organizationId: string): Promise<void> {
  await withDb(async (db) => {
    await db
      .update(workspaceBilling)
      .set({
        workspaceType: WORKSPACE_TYPES.TEAM,
        version: sql`${workspaceBilling.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(eq(workspaceBilling.organizationId, organizationId))
  })
}

/**
 * Assert organization tier is at least minTier.
 * Throws BillingGateError with the appropriate product message.
 */
export async function assertTierAtLeast(
  organizationId: string,
  minTier: SubscriptionTier,
  gate: 'custom_domain' | 'team' | 'generic' = 'generic'
): Promise<WorkspaceBillingRow> {
  const billing = await ensureWorkspaceBilling(organizationId)
  if (isTierAtLeast(billing.subscriptionTier, minTier)) {
    return billing
  }

  if (gate === 'custom_domain') {
    throw new BillingGateError(
      BILLING_ERROR_CODES.CUSTOM_DOMAIN_PREMIUM,
      BILLING_MESSAGES.CUSTOM_DOMAIN
    )
  }
  if (gate === 'team') {
    throw new BillingGateError(
      BILLING_ERROR_CODES.TEAM_WORKSPACE_PREMIUM,
      BILLING_MESSAGES.TEAM_WORKSPACE
    )
  }
  throw new BillingGateError(
    BILLING_ERROR_CODES.TIER_REQUIRED,
    `This feature requires the ${minTier} plan or higher. Please upgrade to continue.`
  )
}
