/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * route.ts — Secure multi-tenant data proxy
 * Copyright (C) 2025 Nextify Limited
 *
 * Generated apps MUST call this HTTP gateway with a project data token.
 * Never expose POSTGRES_URL / DATABASE_URL to user-generated runtimes.
 */

import { z } from 'zod/v4'
import { log, tryCatch } from '@quickxbuild/common'
import {
  createAppData,
  deleteAppData,
  getAppDataById,
  listAppData,
  updateAppData,
  upsertAppData,
  verifyDataProxyToken,
} from '@quickxbuild/db'

/** Request body for write operations. */
const DataProxyBody = z.object({
  collection: z.string().min(1).max(128).optional(),
  recordKey: z.string().min(1).max(256).optional(),
  id: z.string().min(1).max(128).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  limit: z.number().int().positive().max(500).optional(),
})

function unauthorized(message = 'Invalid or missing data proxy token') {
  return Response.json({ error: message }, { status: 401 })
}

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 })
}

function getClaims(request: Request) {
  return verifyDataProxyToken(request.headers.get('authorization'))
}

/** List or get documents. Query: collection?, id?, limit? */
export async function GET(request: Request) {
  const claims = getClaims(request)
  if (!claims) return unauthorized()

  const url = new URL(request.url)
  const id = url.searchParams.get('id')
  const collection = url.searchParams.get('collection') || undefined
  const limitRaw = url.searchParams.get('limit')
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined

  const [result, error] = await tryCatch(async () => {
    if (id) {
      return getAppDataById({
        tenantId: claims.tenantId,
        projectId: claims.projectId,
        id,
      })
    }
    return listAppData({
      tenantId: claims.tenantId,
      projectId: claims.projectId,
      collection,
      limit: Number.isFinite(limit) ? limit : undefined,
    })
  })

  if (error) {
    log.project('error', 'Data proxy GET failed', {
      tenantId: claims.tenantId,
      projectId: claims.projectId,
      operation: 'data-proxy-get',
    }, error instanceof Error ? error : new Error(String(error)))
    return Response.json({ error: 'Failed to read data' }, { status: 500 })
  }

  if (id && result == null) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  return Response.json({ ok: true, data: result })
}

/** Create or upsert a document. */
export async function POST(request: Request) {
  const claims = getClaims(request)
  if (!claims) return unauthorized()

  const [body, parseError] = await tryCatch(async () => DataProxyBody.parse(await request.json()))
  if (parseError || !body) {
    return badRequest('Invalid request body')
  }
  if (!body.data || typeof body.data !== 'object') {
    return badRequest('`data` object is required')
  }

  const [result, error] = await tryCatch(async () => {
    if (body.recordKey) {
      return upsertAppData({
        tenantId: claims.tenantId,
        projectId: claims.projectId,
        collection: body.collection,
        recordKey: body.recordKey,
        data: body.data as Record<string, unknown>,
      })
    }
    return createAppData({
      tenantId: claims.tenantId,
      projectId: claims.projectId,
      collection: body.collection,
      recordKey: body.recordKey ?? null,
      data: body.data as Record<string, unknown>,
    })
  })

  if (error) {
    log.project('error', 'Data proxy POST failed', {
      tenantId: claims.tenantId,
      projectId: claims.projectId,
      operation: 'data-proxy-post',
    }, error instanceof Error ? error : new Error(String(error)))
    return Response.json({ error: 'Failed to write data' }, { status: 500 })
  }

  return Response.json({ ok: true, data: result }, { status: 201 })
}

/** Update document by id. */
export async function PATCH(request: Request) {
  const claims = getClaims(request)
  if (!claims) return unauthorized()

  const [body, parseError] = await tryCatch(async () => DataProxyBody.parse(await request.json()))
  if (parseError || !body?.id || !body.data) {
    return badRequest('`id` and `data` are required')
  }

  const [result, error] = await tryCatch(async () =>
    updateAppData({
      tenantId: claims.tenantId,
      projectId: claims.projectId,
      id: body.id!,
      data: body.data as Record<string, unknown>,
    })
  )

  if (error) {
    log.project('error', 'Data proxy PATCH failed', {
      tenantId: claims.tenantId,
      projectId: claims.projectId,
      operation: 'data-proxy-patch',
    }, error instanceof Error ? error : new Error(String(error)))
    return Response.json({ error: 'Failed to update data' }, { status: 500 })
  }

  if (!result) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json({ ok: true, data: result })
}

/** Delete document by id (?id= or body.id). */
export async function DELETE(request: Request) {
  const claims = getClaims(request)
  if (!claims) return unauthorized()

  const url = new URL(request.url)
  let id = url.searchParams.get('id')
  if (!id) {
    const [body] = await tryCatch(async () => DataProxyBody.parse(await request.json()))
    id = body?.id ?? null
  }
  if (!id) return badRequest('`id` is required')

  const [deleted, error] = await tryCatch(async () =>
    deleteAppData({
      tenantId: claims.tenantId,
      projectId: claims.projectId,
      id,
    })
  )

  if (error) {
    log.project('error', 'Data proxy DELETE failed', {
      tenantId: claims.tenantId,
      projectId: claims.projectId,
      operation: 'data-proxy-delete',
    }, error instanceof Error ? error : new Error(String(error)))
    return Response.json({ error: 'Failed to delete data' }, { status: 500 })
  }

  if (!deleted) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json({ ok: true })
}
