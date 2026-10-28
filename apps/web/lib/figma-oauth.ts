import { env } from '@/env.mjs'

/**
 * Figma OAuth apps expect an HTTPS redirect URI.
 * Do not reuse the HTTP local app URL as-is.
 */
export function figmaRedirectUri(): string {
  if (env.FIGMA_REDIRECT_URI) {
    return env.FIGMA_REDIRECT_URI
  }

  if (process.env.NODE_ENV !== 'production') {
    return 'https://localhost:3000/api/figma/callback'
  }

  const base = new URL(env.NEXT_PUBLIC_APP_URL)
  base.protocol = 'https:'
  base.pathname = '/api/figma/callback'
  base.search = ''
  base.hash = ''
  return base.toString()
}
