import { generateObject } from 'ai'
import { z } from 'zod/v4'
import { selectCapabilities } from '../capabilities'
import { languageModelFor } from '../provider-failover'
import type { ImageData } from '../types'
import type { DesignSpec } from './spec'

/** One region on a screen captured from a user design image. */
export type DesignFrame = z.infer<typeof DesignFrame>
/** Screen inferred from a user design image. */
export const DesignFrame = z.object({
  name: z.string(),
  role: z.string(),
  notes: z.string(),
})

/** Page inferred from a user design image. */
export type DesignPage = z.infer<typeof DesignPage>
/** Page inferred from a user design image. */
export const DesignPage = z.object({
  name: z.string(),
  path: z.string(),
  frames: z.array(DesignFrame),
})

/** Visual system extracted from a user design image. */
export type DesignTheme = z.infer<typeof DesignTheme>
/** Visual system extracted from a user design image. */
export const DesignTheme = z.object({
  background: z.string(),
  foreground: z.string(),
  accent: z.string(),
  font: z.string(),
})

/** Structured reconstruction of an uploaded or pasted design. */
export type VisionDesign = z.infer<typeof VisionDesign>
/** Structured reconstruction of an uploaded or pasted design. */
export const VisionDesign = z.object({
  theme: DesignTheme,
  pages: z.array(DesignPage).min(1),
})

export async function analyzeDesignImage(
  imageData: ImageData,
  prompt: string,
  userPlan: string,
  modelId?: string,
  abortSignal?: AbortSignal
): Promise<DesignSpec> {
  const model = languageModelFor(selectCapabilities(userPlan, modelId).vision)
  const result = await generateObject({
    model,
    schema: VisionDesign,
    abortSignal,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Extract the visual system from this screenshot or mockup.
Return only screens that are visible. Do not invent extra marketing or dashboard pages.
Use hex colors. Paths like / /pricing /dashboard /login.
User request: ${prompt}`,
          },
          {
            type: 'image',
            image: new Uint8Array(imageData.data),
            mediaType: imageData.contentType,
          },
        ],
      },
    ],
  })

  return {
    theme: result.object.theme,
    pages: result.object.pages,
  }
}
