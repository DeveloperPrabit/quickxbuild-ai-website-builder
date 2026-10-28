/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * container-operations.ts
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

import { log, tryCatch } from '@quickxbuild/common'
import { TRPCError } from '@trpc/server'
import { z } from 'zod/v4'
import { organizationProcedure } from '../../trpc'
import { prepareContainer, syncFilesToLocalPreview } from '../../utils/container'
import { ensureLocalPreviewStack, installPreviewPackages } from '../../utils/local-preview-api'
import { handleAsyncScreenshotViaService } from '../../utils/screenshot-client'
import {
  ensureOrgAccess,
  fetchProject,
  parseMessageHistory,
  requireOrgAndUser,
  withDbCleanup,
} from '../../utils/project'

function requestIsHttps(headers?: Headers): boolean {
  const proto = headers?.get('x-forwarded-proto')?.split(',')[0]?.trim()
  if (proto === 'https') {
    return true
  }

  const origin = headers?.get('origin') || headers?.get('referer') || process.env.NEXT_PUBLIC_APP_URL || ''
  return origin.startsWith('https:')
}

/** True only when the platform itself is running on a developer machine. */
function isPlatformLocalDev(): boolean {
  // Prefer public app URL — hosted sites must never embed the developer's localhost.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''
  try {
    const host = new URL(appUrl).hostname.toLowerCase()
    if (host && host !== 'localhost' && host !== '127.0.0.1' && host !== '[::1]') {
      return false
    }
  } catch {
    // fall through
  }

  if (process.env.ENVIRONMENT === 'production') {
    return false
  }

  return process.env.NODE_ENV === 'development'
}

function hasCloudSandboxProvider(): boolean {
  return Boolean(process.env.E2B_API_KEY || process.env.DAYTONA_API_KEY)
}

/** Vite listen URL inside the platform process (health checks / spawn). */
function getInternalPreviewUrl(): string {
  return process.env.LOCAL_PREVIEW_URL || 'http://127.0.0.1:5174'
}

/**
 * Browser-facing preview URL for in-process Vite.
 * Only used on a developer machine without E2B/Daytona.
 * Hosted production always uses cloud sandboxes (E2B) — never VPS Vite.
 */
function getInlinePreviewUrl(headers?: Headers): string | null {
  if (hasCloudSandboxProvider()) {
    return null
  }

  if (!isPlatformLocalDev()) {
    return null
  }

  const configured = getInternalPreviewUrl()
  return requestIsHttps(headers) ? configured.replace(/^http:/, 'https:') : configured
}

/**
 * Build preview URL with planId parameter.
 * Normalize E2B hosts to *.e2b.app so in-app iframes can load.
 */
export function buildPreviewUrl(baseUrl: string, planId?: string): string {
  let normalized = baseUrl
  try {
    const parsed = new URL(baseUrl.includes('://') ? baseUrl : `https://${baseUrl}`)
    if (/\.e2b\.dev$/i.test(parsed.hostname)) {
      parsed.hostname = parsed.hostname.replace(/\.e2b\.dev$/i, '.e2b.app')
    }
    if (!parsed.protocol || parsed.protocol === ':') {
      parsed.protocol = 'https:'
    }
    normalized = parsed.toString()
  } catch {
    normalized = baseUrl.replace(/\.e2b\.dev(\/|$|\?|#)/gi, '.e2b.app$1')
  }

  if (!planId) {
    return normalized
  }

  const [url, urlError] = tryCatch(() => {
    const url = new URL(normalized)
    url.searchParams.set('planId', planId)
    return url.toString()
  })

  if (urlError) {
    // Fallback: manually append planId as query parameter
    log.project('warn', 'URL construction failed, using fallback method', {
      baseUrl: normalized,
      planId,
      error: urlError instanceof Error ? urlError.message : String(urlError),
    })
    const separator = normalized.includes('?') ? '&' : '?'
    return `${normalized}${separator}planId=${encodeURIComponent(planId)}`
  }

  return url
}

/**
 * Get container preview information with error handling
 */
export async function getContainerPreviewInfo(
  container: any,
  projectId: string,
  orgId: string,
  operation: string
): Promise<{ url: string; token?: string }> {
  try {
    const previewInfo = await container.getPreviewInfo(5173)
    
    log.project('info', 'Got preview info from container', {
      orgId,
      projectId,
      operation,
      url: previewInfo.url,
      hasToken: !!previewInfo.token,
    })
    
    return previewInfo
  } catch (error) {
    log.project('error', 'Failed to get preview info from container', {
      orgId,
      projectId,
      operation,
      error: error instanceof Error ? error.message : String(error),
    })
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to get container preview URL',
    })
  }
}

/**
 * Normalize URL to ensure it has a protocol
 */
export function normalizeUrl(url: string): string {
  if (!url || typeof url !== 'string') {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Invalid base URL from container',
    })
  }

  // Ensure the URL has a protocol
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return `https://${url}`
  }

  return url
}

/**
 * Container operations router
 */
export const containerOperations = {
  updateContainerContent: organizationProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { orgId } = await requireOrgAndUser(ctx)

      return await withDbCleanup(async (db) => {
        const projectData = await fetchProject(db, input.id)
        ensureOrgAccess(projectData, orgId, 'access')

        log.project('info', 'Container content update started', {
          orgId,
          projectId: input.id,
          operation: 'container-update',
        })

        // Parse message history and find the latest planId
        const history = parseMessageHistory(projectData.messageHistory)
        const latestMessage = history.findLast((message) => message?.planId)
        const latestPlanId = latestMessage?.planId

        const inlinePreviewUrl = getInlinePreviewUrl(ctx.headers)
        if (inlinePreviewUrl) {
          const sync = await syncFilesToLocalPreview(projectData.messageHistory)
          await ensureLocalPreviewStack(input.id, getInternalPreviewUrl(), {
            reloadApi: sync.serverChanged,
            tenantId: orgId,
          })
          return { success: true, previewURL: buildPreviewUrl(inlinePreviewUrl, latestPlanId) }
        }

        const container = await prepareContainer(ctx, input.id, projectData)
        
        // Get preview info with error handling
        const previewInfo = await getContainerPreviewInfo(
          container,
          input.id,
          orgId,
          'container-update'
        )

        // // Handle async screenshot via new screenshot service
        // await handleAsyncScreenshotViaService(
        //   ctx,
        //   input.id,
        //   latestPlanId || 'initial',
        //   orgId,
        //   previewInfo
        // )

        // Build preview URL with planId
        const previewURL = buildPreviewUrl(previewInfo.url, latestPlanId)

        return { success: true, previewURL }
      })
    }),

  getPreviewUrl: organizationProcedure
    .input(
      z.object({
        id: z.string(),
        planId: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { orgId } = await requireOrgAndUser(ctx)

      return await withDbCleanup(async (db) => {
        const projectData = await fetchProject(db, input.id)
        ensureOrgAccess(projectData, orgId, 'access')

        log.project('info', 'Preview URL requested', {
          orgId,
          projectId: input.id,
          operation: 'preview-url',
          hasPlanId: !!input.planId,
        })

        const inlinePreviewUrl = getInlinePreviewUrl(ctx.headers)
        if (inlinePreviewUrl) {
          await syncFilesToLocalPreview(projectData.messageHistory)
          await ensureLocalPreviewStack(input.id, getInternalPreviewUrl(), {
            tenantId: orgId,
          })
          return { success: true, previewURL: buildPreviewUrl(inlinePreviewUrl, input.planId) }
        }

        // Fast path: do not block preview URL on bun install / long sync.
        const container = await prepareContainer(ctx, input.id, projectData, { mode: 'preview' })

        // Get preview info with error handling
        const previewInfo = await getContainerPreviewInfo(
          container,
          input.id,
          orgId,
          'preview-url'
        )

        // Normalize and validate base URL
        const normalizedBaseUrl = normalizeUrl(previewInfo.url)

        // Build preview URL (planId is optional for this endpoint)
        const previewURL = normalizedBaseUrl

        // Synchronously warm up the preview URL to prevent 502 errors on first load
        // await warmupPreviewUrl(previewURL, orgId, input.id)

        return { success: true, previewURL }
      })
    }),

  installPackages: organizationProcedure
    .input(
      z.object({
        id: z.string(),
        packages: z.array(z.string().min(1)).min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { orgId } = await requireOrgAndUser(ctx)

      return await withDbCleanup(async (db) => {
        const projectData = await fetchProject(db, input.id)
        ensureOrgAccess(projectData, orgId, 'access')

        const inlinePreviewUrl = getInlinePreviewUrl(ctx.headers)
        if (inlinePreviewUrl) {
          const result = await installPreviewPackages(input.packages)
          if (!result.ok) {
            throw new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: result.output || 'Failed to install packages',
            })
          }
          return { success: true, output: result.output }
        }

        const container = await prepareContainer(ctx, input.id, projectData)
        const quoted = input.packages
          .filter((pkg) => /^[@a-zA-Z0-9/_.-]+$/.test(pkg))
          .map((pkg) => pkg.replace(/"/g, ''))
        if (quoted.length === 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'No valid package names',
          })
        }
        const result = await container.executeCommand(
          `cd /home/user/vite-shadcn-template-quickxbuild && bun add ${quoted.join(' ')}`,
          { timeoutMs: 120000 }
        )
        return { success: result.exitCode === 0, output: result.stdout || result.stderr || '' }
      })
    }),
}
