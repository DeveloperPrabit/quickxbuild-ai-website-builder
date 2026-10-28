/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * data-api.ts
 * Copyright (C) 2025 Nextify Limited
 *
 * HTTP client for QuickXBuild's secure multi-tenant data proxy.
 * Prefer this over direct Postgres access in generated apps.
 */

const DATA_API_URL = process.env.QUICKXBUILD_DATA_API_URL
const DATA_API_TOKEN = process.env.QUICKXBUILD_DATA_API_TOKEN

export function isDataProxyConfigured(): boolean {
  return Boolean(DATA_API_URL && DATA_API_TOKEN)
}

async function proxyFetch(
  method: string,
  query?: Record<string, string | undefined>,
  body?: unknown
): Promise<Response> {
  if (!DATA_API_URL || !DATA_API_TOKEN) {
    throw new Error(
      'Data proxy is not configured. Set QUICKXBUILD_DATA_API_URL and QUICKXBUILD_DATA_API_TOKEN (Postgres URLs are not provided to apps).'
    )
  }

  const url = new URL(DATA_API_URL)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value != null && value !== '') {
        url.searchParams.set(key, value)
      }
    }
  }

  return fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${DATA_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

export async function listRecords(collection?: string, limit = 100) {
  const response = await proxyFetch('GET', {
    collection,
    limit: String(limit),
  })
  if (!response.ok) {
    throw new Error(`Data proxy list failed: ${response.status}`)
  }
  return response.json()
}

export async function getRecord(id: string) {
  const response = await proxyFetch('GET', { id })
  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`Data proxy get failed: ${response.status}`)
  }
  return response.json()
}

export async function createRecord(input: {
  collection?: string
  recordKey?: string
  data: Record<string, unknown>
}) {
  const response = await proxyFetch('POST', undefined, input)
  if (!response.ok) {
    throw new Error(`Data proxy create failed: ${response.status}`)
  }
  return response.json()
}

export async function updateRecord(id: string, data: Record<string, unknown>) {
  const response = await proxyFetch('PATCH', undefined, { id, data })
  if (!response.ok) {
    throw new Error(`Data proxy update failed: ${response.status}`)
  }
  return response.json()
}

export async function deleteRecord(id: string) {
  const response = await proxyFetch('DELETE', { id })
  if (!response.ok) {
    throw new Error(`Data proxy delete failed: ${response.status}`)
  }
  return response.json()
}
