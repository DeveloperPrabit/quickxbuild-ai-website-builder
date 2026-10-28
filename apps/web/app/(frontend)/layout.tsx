/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * layout.tsx
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

import {headers} from 'next/headers'
import type React from 'react'
import {cache, Suspense} from 'react'
import {
  baseLocale,
  overwriteGetLocale,
  overwriteGetUrlOrigin,
} from '../../paraglide/runtime'
import './fonts'
import '@quickxbuild/ui/globals.css'
import ClientProviders from '@/components/client-providers'
import {GeneralAnalyticsCollector} from '@/components/general-analytics-collector'
import {GoogleAnalytics} from '@/components/google-analytics'
import {TRPCReactProvider} from '@/trpc/client'
import {Toaster} from '@quickxbuild/ui/components/sonner'
import {ThemeProvider} from 'next-themes'
import type {Metadata} from 'next/types'
import {Body} from './layout.client'
import {siteConfig} from '@/configs/site'

const ssrLocale = cache(() => ({ locale: baseLocale, origin: 'http://localhost' }))

// English-only: always resolve to baseLocale
overwriteGetLocale(() => baseLocale)
overwriteGetUrlOrigin(() => ssrLocale().origin)

export const metadata: Metadata = {
  title: {
    default: siteConfig.name,
    template: `%s - ${siteConfig.name}`,
  },
  metadataBase: new URL(siteConfig.getStartedUrl),
  description: siteConfig.description,
  keywords: [
    "AI development platform",
    "no-code development",
    "low-code platform",
    "AI code generation",
    "natural language programming",
    "full-stack development",
    "web application builder",
    "AI-powered coding",
    "cloud IDE",
    "real-time collaboration",
    "Next.js",
    "React",
    "TypeScript",
    "serverless deployment",
    "Cloudflare Workers",
    "SaaS platform",
    "developer tools",
    "code editor",
    "project management",
    "team collaboration",
    "AI assistant",
    "automated deployment",
    "modern web development",
    "enterprise development",
    "subscription management",
  ],
  openGraph: {
    type: "website",
    locale: "en_US",
    url: siteConfig.getStartedUrl,
    title: siteConfig.name,
    description: siteConfig.description,
    siteName: siteConfig.name,
    images: [
      {
        url: siteConfig.ogImage,
        alt: siteConfig.name,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: siteConfig.name,
    description: siteConfig.description,
    images: [siteConfig.ogImage],
    creator: "@nextify2024",
  },
  icons: {
    icon: "/quickxbuild-mark.svg",
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const headersList = await headers()
  const requestUrl = headersList.get('x-paraglide-request-url') || 'http://localhost'

  // English-only site: ignore Accept-Language / locale cookies
  ssrLocale().locale = baseLocale
  ssrLocale().origin = new URL(requestUrl).origin
  return (
    <html lang='en' suppressHydrationWarning>
      <Body>
        <ClientProviders>
          <ThemeProvider
            attribute='class'
            defaultTheme='dark'
            enableSystem
            disableTransitionOnChange
          >
            <TRPCReactProvider>{children}</TRPCReactProvider>
          </ThemeProvider>
          <Suspense>
            <GoogleAnalytics />
            <GeneralAnalyticsCollector />
            <Toaster />
          </Suspense>
        </ClientProviders>
      </Body>
    </html>
  )
}
