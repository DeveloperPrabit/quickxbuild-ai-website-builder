/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * auth-server.ts
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

import { withCloudflare } from '@quickxbuild/better-auth-cloudflare'
// Declare global KV binding
import { stripe } from '@quickxbuild/better-auth-stripe'
import { log, isDevelopment } from '@quickxbuild/common'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { betterAuth, type Session } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin, bearer, emailOTP, organization } from 'better-auth/plugins'
import { emailHarmony } from 'better-auth-harmony'
import { getAuthDb } from './db'
import { env as envs } from './env.mjs'
import { getActiveOrganization, plugins } from './plugins'
import { getAdminUserIds } from './env.mjs'

// Runtime auth builder using Cloudflare D1 and KV
async function authBuilder() {
  const dbInstance = await getAuthDb()
  const { env } = await getCloudflareContext({ async: true })
  return betterAuth(
    withCloudflare(
      {
        autoDetectIpAddress: true,
        geolocationTracking: true,
        d1: {
          db: dbInstance,
          options: {
            // usePlural: true,
            // debugLogs: true,
          },
        },
        // Use global KV binding in Cloudflare Workers
        // @ts-ignore
        kv: env.KV,
      },
      {
        databaseHooks: {
          session: {
            create: {
              before: async (session: Session) => {
                try {
                  const organization = await getActiveOrganization(session.userId)

                  log.auth('info', 'Session created successfully', {
                    userId: session.userId,
                    organizationId: organization.id,
                    operation: 'session_create',
                  })

                  return {
                    data: {
                      ...session,
                      activeOrganizationId: organization.id,
                    },
                  }
                } catch (error) {
                  log.auth(
                    'error',
                    'Failed to create session',
                    {
                      userId: session.userId,
                      operation: 'session_create',
                    },
                    error as Error
                  )
                  throw error
                }
              },
            },
          },
        },
        socialProviders: {
          github: {
            clientId: envs.BETTER_GITHUB_CLIENT_ID as string,
            clientSecret: envs.BETTER_GITHUB_CLIENT_SECRET as string,
          },
        },
        // Single-host VPS (websitebuilder.*) must use host-only cookies.
        // Cross-subdomain Domain=.techspireglobal.com breaks session after login
        // when the browser won't send that cookie back to the RSC dashboard.
        ...(() => {
          const appUrl = (
            process.env['NEXT_PUBLIC_APP_URL'] ||
            process.env['BETTER_AUTH_URL'] ||
            ''
          ).replace(/\/$/, '')
          if (isDevelopment()) {
            return appUrl ? { baseURL: appUrl } : {}
          }
          const crossSubdomain =
            process.env['AUTH_CROSS_SUBDOMAIN'] === '1' &&
            Boolean(process.env['AUTH_COOKIE_DOMAIN'])
          return {
            ...(appUrl ? { baseURL: appUrl } : {}),
            advanced: {
              useSecureCookies: appUrl.startsWith('https://') || process.env['ENVIRONMENT'] === 'production',
              ...(crossSubdomain
                ? {
                    crossSubDomainCookies: {
                      enabled: true,
                      domain: process.env['AUTH_COOKIE_DOMAIN'] as string,
                    },
                  }
                : {}),
            },
            trustedOrigins: [
              appUrl,
              'https://websitebuilder.techspireglobal.com',
              'https://techspireglobal.com',
              'https://quickxbuild.dev',
              'https://cdn.quickxbuild.dev',
              'https://deploy.quickxbuild.dev',
              'https://dispatcher.quickxbuild.dev',
              'https://auth.quickxbuild.dev',
              'https://api.quickxbuild.dev',
              'https://docs.quickxbuild.dev',
              'https://web.quickxbuild.dev',
              'http://localhost:3000',
              'https://localhost:3000',
            ].filter(Boolean) as string[],
          }
        })(),
        plugins: plugins ,
      }
    )
  )
}

let authInstance: Awaited<ReturnType<typeof authBuilder>> | null = null

// Initialize and get the shared auth instance
export async function initAuth() {
  if (!authInstance) {
    try {
      authInstance = await authBuilder()
    } catch (error) {
      log.auth(
        'error',
        'Failed to initialize auth instance',
        {
          operation: 'auth_init',
        },
        error as Error
      )
      throw error
    }
  }
  return authInstance
}

/* ======================================================================= */
/* Configuration for Schema Generation                                     */
/* Need to use this to generate schema                                     */
/* ======================================================================= */
export const auth = betterAuth({
  ...withCloudflare(
    {
      autoDetectIpAddress: true,
      geolocationTracking: true,
    },
    {
      // No runtime options needed for schema generation
      socialProviders: {
        github: {
          clientId: envs.BETTER_GITHUB_CLIENT_ID as string,
          clientSecret: envs.BETTER_GITHUB_CLIENT_SECRET as string,
        },
      },
      // Enable cross-subdomain cookies for quickxbuild.dev and subdomains
      ...(isDevelopment() ? {} : {
        advanced: {
          crossSubDomainCookies: {
            enabled: true,
            domain: process.env['AUTH_COOKIE_DOMAIN'] || '.techspireglobal.com',
          },
        },
      }),
      plugins: [
        admin({
          defaultRole: 'user',
          adminRoles: ['admin', 'superadmin'],
          adminUserIds: getAdminUserIds(), // Configured via ADMIN_USER_IDS environment variable
        }),
        organization(),
        emailOTP({
          async sendVerificationOTP() {},
        }),
        stripe({
          // stub stripe client for schema generation
          stripeClient: {} as any,
          stripeWebhookSecret: '',
          subscription: { enabled: true, plans: [] },
        }),
        emailHarmony(),
        bearer(),
      ],
    }
  ),
  database: drizzleAdapter(process.env['DATABASE'] as any, {
    provider: 'sqlite',
  }),
})
