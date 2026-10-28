/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * session.ts
 * Copyright (C) 2025 Nextify Limited
 */

import { session } from '@quickxbuild/auth/db/schema/auth-schema'
import { tryCatch } from '@quickxbuild/common'
import type { TRPCRouterRecord } from '@trpc/server'
import { TRPCError } from '@trpc/server'
import { and, desc, eq, ne } from 'drizzle-orm'
import { z } from 'zod/v4'
import { organizationProcedure } from '../trpc'

export const sessionRouter = {
  list: organizationProcedure.query(async ({ ctx }) => {
    const orgId = ctx.orgId
    const userId = ctx.session.user.id
    if (!orgId) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Organization ID is missing' })
    }

    const [sessions, error] = await tryCatch(async () => {
      return await ctx.db
        .select()
        .from(session)
        .where(and(eq(session.userId, userId), eq(session.activeOrganizationId, orgId)))
        .orderBy(desc(session.updatedAt))
    })

    if (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred while fetching the session list',
        cause: error,
      })
    }

    return sessions
  }),

  revoke: organizationProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id
      const currentId = ctx.session.session?.id
      if (!currentId) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Current session missing' })
      }

      if (input.sessionId === currentId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot revoke the current session from this page',
        })
      }

      const [result, error] = await tryCatch(async () => {
        return await ctx.db
          .delete(session)
          .where(and(eq(session.id, input.sessionId), eq(session.userId, userId)))
      })

      if (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to revoke session',
          cause: error,
        })
      }

      return { ok: true, result }
    }),

  revokeOthers: organizationProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id
    const currentId = ctx.session.session?.id
    if (!currentId) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Current session missing' })
    }

    const [, error] = await tryCatch(async () => {
      return await ctx.db
        .delete(session)
        .where(and(eq(session.userId, userId), ne(session.id, currentId)))
    })

    if (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to revoke other sessions',
        cause: error,
      })
    }

    return { ok: true }
  }),
} satisfies TRPCRouterRecord
