/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * billing-page-client.tsx
 */

'use client'

import {
  SubscriptionManagement,
  type BillingSubscription,
} from '@/components/billing/subscription-management'

interface BillingPageClientProps {
  subscription: BillingSubscription
}

export default function BillingPageClient({ subscription }: BillingPageClientProps) {
  return <SubscriptionManagement subscription={subscription} />
}
