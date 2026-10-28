/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * generate-image.ts
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

import { experimental_generateImage, type ImageModel } from 'ai'
import { selectCapabilities } from '../capabilities'

/** Max successful generate_image calls per agent loop. */
export const MAX_GENERATED_IMAGES = 3

/** Directory for generated asset TypeScript modules. */
export const GENERATED_ASSETS_DIR = 'src/assets/generated'

/** Unused Grok image key kept as last-resort fallback. */
export const IMAGE_FALLBACK_MODEL = 'small-model-xai'

/** Result of a successful image generation write. */
export type GenerateImageSuccess = {
  ok: true
  path: string
  content: string
  mimeType: string
}

/** Result of a failed image generation attempt. */
export type GenerateImageFailure = {
  ok: false
  error: string
}

/** Outcome of runGenerateImage. */
export type GenerateImageResult = GenerateImageSuccess | GenerateImageFailure

/** Shared counter for the per-loop image cap. */
export type ImageBudget = {
  count: number
  max: number
}

type GenerateImageFn = typeof experimental_generateImage

/**
 * Force an asset path under src/assets/generated/*.ts.
 * Rejects path traversal and absolute paths.
 */
export function sanitizeGeneratedImagePath(
  requested?: string,
  prompt = 'image'
): { ok: true; path: string } | { ok: false; error: string } {
  if (
    requested &&
    (requested.includes('..') ||
      requested.includes('\0') ||
      requested.startsWith('/') ||
      /^[a-zA-Z]:[\\/]/.test(requested))
  ) {
    return { ok: false, error: 'Invalid image path: path traversal is not allowed' }
  }

  const raw = requested
    ? requested.replace(/\\/g, '/').split('/').pop() || 'image'
    : prompt.slice(0, 48)

  const slug =
    raw
      .replace(/\.[a-zA-Z0-9]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'image'

  return { ok: true, path: `${GENERATED_ASSETS_DIR}/${slug}.ts` }
}

/** Build an importable Vite module that exports a data URL. */
export function buildAssetModule(base64: string, mimeType: string, alt: string): string {
  const safeMime = mimeType || 'image/png'
  return `export const src = 'data:${safeMime};base64,${base64}'\nexport const alt = ${JSON.stringify(alt)}\n`
}

function resolveImageModel(id: string): ImageModel {
  // Lazy load so mocked unit tests do not need full env/providers.
  const { myProvider } = require('../providers') as typeof import('../providers')
  return myProvider.imageModel(id)
}

/**
 * Generate an image with openai-image (gpt-image-1), falling back to Grok once.
 * Returns a TypeScript module path and content for the user project.
 */
export async function runGenerateImage(input: {
  prompt: string
  path?: string
  alt?: string
  userPlan: string
  modelId?: string
  abortSignal?: AbortSignal
  generate?: GenerateImageFn
  getImageModel?: (id: string) => ImageModel
}): Promise<GenerateImageResult> {
  const sanitized = sanitizeGeneratedImagePath(input.path, input.prompt)
  if (!sanitized.ok) {
    return sanitized
  }

  const alt = input.alt || input.prompt.slice(0, 120)
  const capabilities = selectCapabilities(input.userPlan, input.modelId)
  const modelIds = [...new Set([capabilities.image, IMAGE_FALLBACK_MODEL])]
  const generate = input.generate || experimental_generateImage
  const getImageModel = input.getImageModel || resolveImageModel

  let lastError = 'Image generation failed'
  for (const imageModelId of modelIds) {
    try {
      const result = await generate({
        model: getImageModel(imageModelId),
        prompt: input.prompt,
        n: 1,
        size: '1024x1024',
        ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
      })
      const mimeType = result.image.mediaType || 'image/png'
      return {
        ok: true,
        path: sanitized.path,
        content: buildAssetModule(result.image.base64, mimeType, alt),
        mimeType,
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      console.error(`Image model ${imageModelId} failed:`, error)
    }
  }

  return { ok: false, error: lastError }
}
