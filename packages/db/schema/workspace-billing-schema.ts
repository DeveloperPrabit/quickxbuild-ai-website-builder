/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * workspace-billing-schema.ts
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

import { sql } from 'drizzle-orm'
import { integer, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core'

/** Monetization tiers for Lovable-style feature gates. */
export const SUBSCRIPTION_TIERS = {
  FREE: 'FREE',
  BASIC: 'BASIC',
  BUSINESS: 'BUSINESS',
  ADVANCED: 'ADVANCED',
} as const

export type SubscriptionTier = (typeof SUBSCRIPTION_TIERS)[keyof typeof SUBSCRIPTION_TIERS]

/** Workspace collaboration mode. */
export const WORKSPACE_TYPES = {
  PERSONAL: 'PERSONAL',
  TEAM: 'TEAM',
} as const

export type WorkspaceType = (typeof WORKSPACE_TYPES)[keyof typeof WORKSPACE_TYPES]

/** Default trial credits for new FREE workspaces. */
export const DEFAULT_TRIAL_CREDITS = 10

/**
 * Gate source of truth for credits, subscription tier, and workspace type.
 * Keyed by D1 organization id (string), not a Postgres FK.
 */
export const workspaceBilling = pgTable('workspace_billing', {
  organizationId: text('organization_id').primaryKey(),
  creditsBalance: integer('credits_balance').notNull().default(DEFAULT_TRIAL_CREDITS),
  subscriptionTier: varchar('subscription_tier', {
    enum: ['FREE', 'BASIC', 'BUSINESS', 'ADVANCED'],
  })
    .notNull()
    .default('FREE'),
  workspaceType: varchar('workspace_type', {
    enum: ['PERSONAL', 'TEAM'],
  })
    .notNull()
    .default('PERSONAL'),
  stripeCustomerId: text('stripe_customer_id'),
  version: integer('version').notNull().default(0),
  createdAt: timestamp('created_at', {
    withTimezone: true,
    mode: 'string',
  }).default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp('updated_at', {
    withTimezone: true,
    mode: 'string',
  })
    .defaultNow()
    .notNull()
    .$onUpdate(() => sql`now()`),
})
