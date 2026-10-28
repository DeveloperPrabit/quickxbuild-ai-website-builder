/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * app-sidebar.tsx
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

'use client'

import { authClient } from '@quickxbuild/auth/auth-client'
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader } from '@quickxbuild/ui/components/sidebar'
import {
  CreditCardIcon,
  FileIcon,
  HeadphonesIcon,
  HelpCircleIcon,
  LayoutDashboardIcon,
  MailCheckIcon,
  MonitorIcon,
  MonitorSmartphoneIcon,
  NetworkIcon,
  SearchIcon,
  Share2Icon,
  ShieldIcon,
  UsersIcon,
} from 'lucide-react'
import type * as React from 'react'
import { Suspense, useEffect, useState } from 'react'
import { BrandMark } from '@/components/common/logo/BrandMark'
import * as m from '@/paraglide/messages'
import { MdForum } from 'react-icons/md'
import Github from '../logos/github'
import { NavMain, type NavSection } from './nav-main'
import { NavSecondary } from './nav-secondary'
import { NavUser } from './nav-user'
import { WorkspaceSwitcher } from './workspace-switch'

// Create a WorkspaceSkeleton component
const WorkspaceSkeleton = () => {
  return (
    <div className='p-4'>
      <div className='flex items-center space-x-2'>
        {/* Skeleton - avatar placeholder */}
        <div className='w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse' />
        <div className='flex-1'>
          {/* Skeleton - workspace name placeholder */}
          <div className='h-4 w-24 bg-gray-200 dark:bg-gray-700 rounded animate-pulse' />
          {/* Skeleton - plan name placeholder */}
          <div className='h-3 w-12 bg-gray-100 dark:bg-gray-800 rounded mt-1 animate-pulse' />
        </div>
        {/* Skeleton - dropdown button placeholder */}
        <div className='w-5 h-5 rounded bg-gray-200 dark:bg-gray-700 animate-pulse' />
      </div>
    </div>
  )
}

// Define organization type based on database schema
interface Organization {
  id: string
  name: string
  slug?: string | null
  logo?: string | null
  createdAt: Date
  metadata?: string | null
}

// Update subscription data type to match API return values
interface SubscriptionData {
  id: string
  plan: string
  referenceId: string
  stripeCustomerId?: string | undefined
  stripeSubscriptionId?: string | undefined
  status: string | undefined | null
  periodStart?: Date | null
  periodEnd?: Date | null
  cancelAtPeriodEnd?: boolean | null
  seats?: number | undefined
  // Add other fields returned by API
  limits?: Record<string, number> | undefined
  priceId?: string | undefined

  // Keep other possible fields
  [key: string]: any
}

// Define the workspace data structure
interface WorkspaceData extends Organization {
  subscription: SubscriptionData | null
}

// Define user data structure
interface UserData {
  id: string
  name: string
  email: string
  image?: string | null
  activeOrganizationId?: string

  [key: string]: any
}

// Define workspace interface data structure
interface ProcessedWorkspace {
  id: string
  name: string
  logo: React.ElementType
  plan: string
  planColor: string
  planGradient: string
  planBadgeClass: string
  slug?: string
}

const getNavSections = (isAdmin: boolean): NavSection[] => {
  const mainItems = [
    ...(isAdmin
      ? [
          {
            title: 'Admin',
            url: '/dashboard/admin',
            icon: ShieldIcon,
          },
        ]
      : []),
    {
      title: m['dashboard.sidebar.navigation.dashboard'](),
      url: '/dashboard',
      icon: LayoutDashboardIcon,
      tab: 'overview',
    },
    {
      title: m['dashboard.sidebar.navigation.teams'](),
      url: '/dashboard/teams',
      icon: UsersIcon,
    },
    {
      title: m['dashboard.sidebar.navigation.billing'](),
      url: '/dashboard/billing',
      icon: CreditCardIcon,
    },
    {
      title: m['dashboard.sidebar.navigation.session'](),
      url: '/dashboard/session',
      icon: MonitorSmartphoneIcon,
    },
    {
      title: m['dashboard.sidebar.navigation.integrations'](),
      url: '/dashboard/integrations',
      icon: NetworkIcon,
    },
  ]

  const autonomous: NavSection = {
    label: 'Autonomous AI Suite',
    items: [
      {
        title: 'AI Receptionist',
        url: '/dashboard?tab=receptionist',
        icon: HeadphonesIcon,
        tab: 'receptionist',
        badgeDot: true,
      },
      {
        title: 'Email & CRM',
        url: '/dashboard?tab=crm',
        icon: MailCheckIcon,
        tab: 'crm',
      },
      {
        title: 'Social Marketing',
        url: '/dashboard?tab=social',
        icon: Share2Icon,
        tab: 'social',
      },
      {
        title: 'Website Studio',
        url: '/dashboard?tab=studio',
        icon: MonitorIcon,
        tab: 'studio',
      },
      {
        title: 'SEO Auto-Fixer',
        url: '/dashboard?tab=seo',
        icon: SearchIcon,
        tab: 'seo',
      },
    ],
  }

  return [
    {
      label: 'Main',
      items: mainItems,
    },
    autonomous,
  ]
}

const getNavSecondaryItems = () => [
  {
    title: m['dashboard.sidebar.navigation.docs'](),
    url: 'https://docs.quickxbuild.dev',
    icon: FileIcon,
  },
  {
    title: m['dashboard.sidebar.navigation.github'](),
    url: 'https://github.com/nextify-limited/quickxbuild',
    icon: Github,
  },
  {
    title: m['dashboard.sidebar.navigation.support'](),
    url: 'https://forum.quickxbuild.dev',
    icon: MdForum,
  },
  {
    title: m['dashboard.sidebar.navigation.help'](),
    url: 'https://forum.quickxbuild.dev/c/9-category/9',
    icon: HelpCircleIcon,
  },
]

export function AppSidebar({
  userData,
  ...props
}: {
  userData: UserData
} & React.ComponentProps<typeof Sidebar>) {
  const { data: session } = authClient.useSession()
  const isAdmin = session?.user?.role === 'admin' || session?.user?.role === 'superadmin'

  // Use authClient to get organization list - add isPending state
  const { data: organizations = [], isPending: organizationsPending } =
    // @ts-ignore
    authClient.useListOrganizations()
  // @ts-ignore
  const { data: activeOrganization } = authClient.useActiveOrganization()

  // Use useState to store subscription data
  const [subscriptions, setSubscriptions] = useState<SubscriptionData[]>([])
  // Add loading state tracking
  const [isLoading, setIsLoading] = useState<boolean>(true)
  // Use useEffect to asynchronously fetch subscription data
  useEffect(() => {
    // Only fetch subscriptions when organizationsPending is false and organizations has data
    const orgs = organizations || [] // Ensure orgs is always an array, prevent null
    if (!organizationsPending && orgs.length > 0) {
      const fetchAllSubscriptions = async () => {
        try {
          const subscriptionPromises = orgs.map((org: any) =>
            // @ts-ignore
            authClient.subscription.list({
              query: {
                referenceId: org.id,
              },
            })
          )
          const results = await Promise.all(subscriptionPromises)
          const allSubscriptions = results.flatMap((result: { data: any }) => result.data || [])
          setSubscriptions(allSubscriptions)
          setIsLoading(false)
        } catch (error) {
          setSubscriptions([])
          setIsLoading(false)
        }
      }
      fetchAllSubscriptions()
    } else if (!organizationsPending && orgs.length === 0) {
      // Organizations loaded but empty
      setSubscriptions([])
      setIsLoading(false)
    } else {
      // Organizations still loading, keep loading state
      setIsLoading(true)
    }
  }, [organizations, organizationsPending])

  // Extract username from email (part before the @ symbol)
  const extractUsernameFromEmail = (email: string): string => {
    if (!email || email.trim() === '') return ''
    // Get the content before the @ symbol as the username
    const username = email.split('@')[0]
    // If extraction is successful and not empty, return that username, otherwise return empty string
    return username || ''
  }

  // Process user data
  const processedUserData = {
    name: userData.name || extractUsernameFromEmail(userData.email) || 'Guest',
    email: userData.email || 'No email',
    avatar: userData.image || '/avatars/default.jpg',
    status: 'online' as const,
    notificationCount: 0,
  }

  // Process workspace data
  const workspaces: ProcessedWorkspace[] = (organizations || []).map(
    (organization: { id: string; name: any; slug: any }) => {
      // Find matching subscription data
      const subscription =
        subscriptions.find(
          (sub) => sub && sub.referenceId === organization.id && sub.status === 'active'
        ) || null

      // Crisp vector mark (matches Obsidian Kinetic canvas — no torn photo fringe)
      const logo = BrandMark

      // Determine plan type from Stripe sub or membership quota row
      let plan = 'FREE'
      const rawPlan = String(subscription?.plan || '').toLowerCase()
      if (rawPlan.includes('enterprise') || rawPlan.includes('max')) plan = 'ENTERPRISE'
      else if (rawPlan.includes('business') || rawPlan.includes('pro') || rawPlan.includes('basic'))
        plan = 'PRO'

      // Add plan colors and icons
      let planColor = 'text-gray-500'
      let planGradient = 'from-gray-400 to-gray-600'
      let planBadgeClass =
        'bg-[rgba(161,161,170,0.15)] text-[var(--qx-muted,#a1a1aa)]'

      switch (plan) {
        case 'PRO':
          planColor = 'text-[#38bdf8]'
          planGradient = 'from-sky-400 to-sky-600'
          planBadgeClass = 'bg-[rgba(56,189,248,0.18)] text-[#38bdf8]'
          break
        case 'ENTERPRISE':
          planColor = 'text-[#38bdf8]'
          planGradient = 'from-sky-400 to-indigo-500'
          planBadgeClass =
            'bg-[rgba(56,189,248,0.2)] text-[#38bdf8] uppercase tracking-wide'
          break
      }

      return {
        id: organization.id,
        name: organization.name,
        logo,
        plan,
        planColor,
        planGradient,
        planBadgeClass,
        slug: organization.slug || undefined,
      }
    }
  )

  return (
    <Sidebar collapsible='offcanvas' {...props}>
      <SidebarHeader>
        {isLoading ? <WorkspaceSkeleton /> : <WorkspaceSwitcher teams={workspaces} />}
      </SidebarHeader>
      <SidebarContent className='gap-1'>
        <Suspense fallback={null}>
          <NavMain sections={getNavSections(isAdmin)} />
        </Suspense>
        <NavSecondary items={getNavSecondaryItems()} className='mt-auto' label='Resources' />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={processedUserData} />
      </SidebarFooter>
    </Sidebar>
  )
}
