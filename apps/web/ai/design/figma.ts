import { env } from '@/env.mjs'
import { log } from '@quickxbuild/common'
import {
  buildLocalDesignSpec,
  formatDesignMessage,
  formatDesignXml,
  needsDesignSpec,
  type DesignSpec,
} from './spec'

export type { DesignSpec }
export { buildLocalDesignSpec, formatDesignMessage, formatDesignXml, needsDesignSpec }

function figmaHeaders(token: string): HeadersInit {
  if (token.startsWith('figu_')) {
    return { Authorization: `Bearer ${token}` }
  }
  return { 'X-Figma-Token': token }
}

/**
 * QuickXBuild-owned Figma token only. Fail open with a local spec if REST cannot write/read.
 */
export async function prepareDesignSpec(prompt: string): Promise<DesignSpec> {
  const spec = buildLocalDesignSpec(prompt)
  const token = env.FIGMA_ACCESS_TOKEN
  const fileKey = env.FIGMA_FILE_KEY

  if (!token) {
    const oauthReady = Boolean(env.FIGMA_CLIENT_ID && env.FIGMA_CLIENT_SECRET)
    return {
      ...spec,
      warning: oauthReady
        ? 'FIGMA_ACCESS_TOKEN missing. Connect QuickXBuild Figma at /api/figma/connect, then set the token. Users do not add a Figma key.'
        : 'FIGMA_ACCESS_TOKEN missing. Continuing with a local design spec. Users do not add a Figma key.',
    }
  }

  if (!fileKey) {
    return {
      ...spec,
      warning: 'FIGMA_FILE_KEY missing. REST cannot create a new Figma file from scratch; using local spec in QuickXBuild team later.',
    }
  }

  try {
    const response = await fetch(`https://api.figma.com/v1/files/${fileKey}`, {
      headers: figmaHeaders(token),
    })
    if (!response.ok) {
      return { ...spec, fileKey, warning: `Figma read failed (${response.status}). Using local spec.` }
    }
    spec.fileKey = fileKey
    spec.fileUrl = `https://www.figma.com/design/${fileKey}`
    return spec
  } catch (error) {
    log.ai('warn', 'Figma API failed open', {
      operation: 'figma-design',
      error: error instanceof Error ? error.message : String(error),
    })
    return { ...spec, warning: 'Figma API failed. Using local spec.' }
  }
}
