import { describe, expect, it } from 'vitest'
import { resolvePreviewEmbedUrl } from './browser-utils'

describe('resolvePreviewEmbedUrl', () => {
  it('upgrades local HTTP preview when the IDE is HTTPS', () => {
    expect(
      resolvePreviewEmbedUrl('http://localhost:5174/', 'https://localhost:3000')
    ).toBe('https://localhost:5174/')
  })

  it('keeps HTTP preview when the IDE is HTTP', () => {
    expect(
      resolvePreviewEmbedUrl('http://localhost:5174/', 'http://localhost:3000')
    ).toBe('http://localhost:5174/')
  })

  it('never embeds the QuickXBuild project page', () => {
    expect(
      resolvePreviewEmbedUrl(
        'https://localhost:3000/project/o2pi598h5rgrbq9gtq11ft1w',
        'https://localhost:3000'
      )
    ).toBeNull()
  })

  it('does not HTTPS-upgrade localhost when the IDE is on a public domain', () => {
    expect(
      resolvePreviewEmbedUrl(
        'http://localhost:5174/',
        'https://websitebuilder.techspireglobal.com'
      )
    ).toBe('http://localhost:5174/')
  })

  it('rewrites E2B .dev hosts to .app for iframe embeds', () => {
    expect(
      resolvePreviewEmbedUrl(
        'https://5173-abc.e2b.dev/',
        'https://websitebuilder.techspireglobal.com'
      )
    ).toBe('https://5173-abc.e2b.app/')
  })
})
