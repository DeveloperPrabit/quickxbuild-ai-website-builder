import { afterEach, describe, expect, it, vi } from 'vitest'

const museState = vi.hoisted(() => ({ enabled: false }))

vi.mock('../providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../providers')>()
  return {
    ...actual,
    isMuseConfigured: () => museState.enabled,
    MUSE_MODEL_ID: 'chat-model-reasoning-muse',
  }
})

import { AUTO_MODEL_ID, getDefaultModelForPlan } from '@/configs/ai-models'
import { hasFileActionXml, requiresApply, extractWritesFromXml } from '../agent/apply'
import {
  IMAGE_FALLBACK_MODEL,
  MAX_GENERATED_IMAGES,
  buildAssetModule,
  runGenerateImage,
  sanitizeGeneratedImagePath,
} from '../agent/generate-image'
import { formatRecentChat } from '../agent/history'
import { normalizeFileMap, resolveFilePath } from '../agent/file-map'
import { formatRelevantFiles, pickRelevantFiles } from '../agent/relevant'
import { markTasksAfterApply, planTasksFromPrompt } from '../agent/tasks'
import { createAgentTools } from '../agent/tools'
import { selectCapabilities } from '../capabilities'
import { selectAgentModels, selectModel } from '../select-models'

describe('requiresApply', () => {
  it('requires file actions for implement and fix prompts', () => {
    expect(requiresApply('add a save button on the dashboard and update the API')).toBe(true)
    expect(requiresApply('fix the blank preview')).toBe(true)
  })

  it('does not require actions for a pure question', () => {
    expect(requiresApply('what is React Query?')).toBe(false)
  })
})

describe('hasFileActionXml', () => {
  it('detects file actions', () => {
    expect(hasFileActionXml('<plan><action type="file"><file filename="a.tsx">x</file></action></plan>')).toBe(true)
    expect(hasFileActionXml('<plan><action description="Update file" type="file"><file filename="a.tsx">x</file></action></plan>')).toBe(true)
    expect(hasFileActionXml('<plan><thinking>only</thinking></plan>')).toBe(false)
  })
})

describe('extractWritesFromXml', () => {
  it('extracts file path and CDATA content from plan XML', () => {
    const xml = `<plan>
<action type="file">
<description><![CDATA[Add signup page]]></description>
<file filename="src/pages/Signup.tsx"><![CDATA[export default function Signup() { return null }]]></file>
</action>
</plan>`
    const writes = extractWritesFromXml(xml)
    expect(writes).toHaveLength(1)
    expect(writes[0]?.path).toBe('src/pages/Signup.tsx')
    expect(writes[0]?.content).toContain('function Signup')
    expect(writes[0]?.description).toBe('Add signup page')
  })
})

describe('agent tool payloads', () => {
  it('accepts JSON-string tool arguments from the AI SDK', () => {
    const payload = JSON.stringify({ path: 'src/pages/Admin.tsx', content: 'SAVE', description: 'Add save button' })
    expect(JSON.parse(payload).path).toBe('src/pages/Admin.tsx')
    expect(JSON.parse(payload).content).toBe('SAVE')
  })
})

describe('planTasksFromPrompt', () => {
  it('splits UI and API work for any user project', () => {
    const tasks = planTasksFromPrompt('add a save button on the dashboard and update the API route')
    expect(tasks.some((task) => task.id === 'openai-ui' || task.agent === 'openai-frontend')).toBe(true)
    expect(tasks.some((task) => task.id === 'cursor-api' || task.agent === 'cursor-backend')).toBe(true)
    expect(tasks[0]?.agent).toBe('planner')
  })

  it('marks implementer tasks failed when apply is missing', () => {
    const marked = markTasksAfterApply(planTasksFromPrompt('fix shop'), false)
    expect(marked.every((task) => task.status === 'done' || task.status === 'failed' || task.status === 'blocked')).toBe(true)
    expect(marked.some((task) => task.status === 'failed' || task.status === 'blocked')).toBe(true)
  })

  it('attaches files when apply succeeds', () => {
    const marked = markTasksAfterApply(planTasksFromPrompt('fix shop'), true, undefined, ['src/App.tsx'])
    expect(marked.filter((task) => task.status !== 'blocked').every((task) => task.status === 'done')).toBe(true)
    expect(marked.some((task) => task.files.includes('src/App.tsx'))).toBe(true)
  })
})

describe('normalizeFileMap', () => {
  it('resolves user project paths for tools', () => {
    const map = normalizeFileMap({
      './src/pages/Shop.tsx': { content: 'SHOP' },
    })
    expect(resolveFilePath(map, 'src/pages/Shop.tsx')).toBe('src/pages/Shop.tsx')
    expect(map['src/pages/Shop.tsx']?.content).toBe('SHOP')
  })
})

describe('pickRelevantFiles', () => {
  it('picks files from the user project that match the request', () => {
    const picked = pickRelevantFiles({
      'src/pages/Dashboard.tsx': { content: 'DASH' },
      'server/schema.ts': { content: 'SCHEMA' },
      'src/other.ts': { content: 'SKIP' },
    }, 'update the dashboard save button')
    expect(picked).toContain('src/pages/Dashboard.tsx')
    expect(picked).toContain('server/schema.ts')
    expect(picked).not.toContain('src/other.ts')
  })
})

describe('formatRelevantFiles', () => {
  it('sends a path index and only requested file bodies', () => {
    const xml = formatRelevantFiles({
      'src/pages/Admin.tsx': { content: 'SAVE' },
      'src/pages/Shop.tsx': { content: 'SHOP' },
      'src/other.ts': { content: 'SKIP' },
    }, ['src/pages/Admin.tsx'])
    expect(xml).toContain('src/pages/Admin.tsx')
    expect(xml).toContain('SAVE')
    expect(xml).not.toContain('SKIP')
  })
})

describe('selectCapabilities', () => {
  afterEach(() => {
    museState.enabled = false
  })

  it('routes Auto + Max to Astra for reason, mini for fast, and openai-image', () => {
    const caps = selectCapabilities('quickxbuild max')
    expect(caps.reason).toBe('chat-model-reasoning-openai-astra')
    expect(caps.code).toBe('chat-model-reasoning-openai-astra')
    expect(caps.fast).toBe('chat-model-reasoning-openai-mini')
    expect(caps.vision).toBe('chat-model-reasoning-openai-astra')
    expect(caps.image).toBe('openai-image')
  })

  it('routes Auto + Free to GPT 4.1 for reason without Astra', () => {
    const caps = selectCapabilities('quickxbuild free', AUTO_MODEL_ID)
    expect(caps.reason).toBe('chat-model-reasoning-openai')
    expect(caps.reason).not.toBe('chat-model-reasoning-openai-astra')
    expect(caps.vision).toBe('chat-model-reasoning-openai')
    expect(caps.fast).toBe('chat-model-reasoning-openai-mini')
    expect(caps.image).toBe('openai-image')
  })

  it('keeps a Claude pin on reason and code while vision stays OpenAI', () => {
    const caps = selectCapabilities('quickxbuild pro', 'claude-4-0-sonnet')
    expect(caps.reason).toBe('chat-model-reasoning-anthropic')
    expect(caps.code).toBe('chat-model-reasoning-anthropic')
    expect(caps.vision).toBe('chat-model-reasoning-openai')
    expect(caps.fast).toBe('chat-model-reasoning-openai-mini')
    expect(caps.image).toBe('openai-image')
  })

  it('uses mini for file-edit', () => {
    const caps = selectCapabilities('quickxbuild max', AUTO_MODEL_ID, true)
    expect(caps.fast).toBe('chat-model-reasoning-openai-mini')
    expect(selectModel('quickxbuild max', AUTO_MODEL_ID, true)).toBe('chat-model-reasoning-openai-mini')
    expect(selectAgentModels('quickxbuild max', AUTO_MODEL_ID, true)[0]).toBe('chat-model-reasoning-openai-mini')
  })

  it('routes all text capabilities to Muse when MODEL_API_KEY is configured', () => {
    museState.enabled = true
    const caps = selectCapabilities('quickxbuild free', AUTO_MODEL_ID)
    expect(caps.reason).toBe('chat-model-reasoning-muse')
    expect(caps.code).toBe('chat-model-reasoning-muse')
    expect(caps.fast).toBe('chat-model-reasoning-muse')
    expect(caps.vision).toBe('chat-model-reasoning-muse')
    expect(caps.image).toBe('openai-image')
  })
})

describe('selectAgentModels', () => {
  afterEach(() => {
    museState.enabled = false
  })

  it('does not grab Claude or Gemini on Auto', () => {
    const free = selectAgentModels('quickxbuild free')
    expect(free[0]).toBe('chat-model-reasoning-openai')
    expect(free).toContain('chat-model-reasoning-openai-mini')
    expect(free).not.toContain('chat-model-reasoning-openai-astra')
    expect(free).not.toContain('chat-model-reasoning-anthropic')
    expect(free).not.toContain('chat-model-reasoning-google')

    const max = selectAgentModels('quickxbuild max')
    expect(max[0]).toBe('chat-model-reasoning-openai-astra')
    expect(max).toContain('chat-model-reasoning-openai-mini')
    expect(max).not.toContain('chat-model-reasoning-anthropic')
  })
})

describe('getDefaultModelForPlan', () => {
  it('defaults every plan to Auto', () => {
    expect(getDefaultModelForPlan('quickxbuild free').id).toBe(AUTO_MODEL_ID)
    expect(getDefaultModelForPlan('quickxbuild pro').id).toBe(AUTO_MODEL_ID)
    expect(getDefaultModelForPlan('quickxbuild max').id).toBe(AUTO_MODEL_ID)
  })
})

describe('formatRecentChat', () => {
  it('keeps the latest user and plan turns', () => {
    const history = JSON.stringify([
      { type: 'user', message: 'old', planId: '1' },
      { type: 'plan', content: 'planned', planId: '1' },
      { type: 'user', message: 'fix shop', planId: '2' },
    ])
    expect(formatRecentChat(history)).toContain('fix shop')
  })
})

describe('generate_image', () => {
  it('normalizes paths under src/assets/generated and rejects traversal', () => {
    expect(sanitizeGeneratedImagePath('hero.png')).toEqual({
      ok: true,
      path: 'src/assets/generated/hero.ts',
    })
    expect(sanitizeGeneratedImagePath('src/assets/generated/product.webp')).toEqual({
      ok: true,
      path: 'src/assets/generated/product.ts',
    })
    expect(sanitizeGeneratedImagePath('../etc/passwd').ok).toBe(false)
    expect(sanitizeGeneratedImagePath('/abs/evil').ok).toBe(false)
  })

  it('builds a data URL module for Vite import', () => {
    const mod = buildAssetModule('abc123', 'image/png', 'Hero shot')
    expect(mod).toContain("export const src = 'data:image/png;base64,abc123'")
    expect(mod).toContain('export const alt = "Hero shot"')
  })

  it('writes src/assets/generated/*.ts containing a data URL', async () => {
    const result = await runGenerateImage({
      prompt: 'linen jacket on cream',
      path: 'product',
      userPlan: 'quickxbuild free',
      getImageModel: () => ({}) as never,
      generate: async () =>
        ({
          image: { base64: 'AAA', uint8Array: new Uint8Array(), mediaType: 'image/png' },
          images: [],
          warnings: [],
          responses: [],
          providerMetadata: {},
        }) as never,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.path).toBe('src/assets/generated/product.ts')
    expect(result.content).toContain('data:image/png;base64,AAA')
  })

  it('falls back to Grok when OpenAI image fails', async () => {
    const tried: string[] = []
    const result = await runGenerateImage({
      prompt: 'hero banner',
      userPlan: 'quickxbuild max',
      getImageModel: (id) => {
        tried.push(id)
        return {} as never
      },
      generate: async () => {
        if (tried.at(-1) === 'openai-image') {
          throw new Error('openai down')
        }
        return {
          image: { base64: 'BBB', uint8Array: new Uint8Array(), mediaType: 'image/png' },
          images: [],
          warnings: [],
          responses: [],
          providerMetadata: {},
        } as never
      },
    })
    expect(tried).toEqual(['openai-image', IMAGE_FALLBACK_MODEL])
    expect(result.ok).toBe(true)
  })

  it('caps at 3 images per request without a fourth write', async () => {
    const fileMap: Record<string, { content?: string }> = {}
    const imageBudget = { count: 0, max: MAX_GENERATED_IMAGES }
    let n = 0
    const { tools, writes } = createAgentTools(fileMap, {
      userPlan: 'quickxbuild free',
      imageBudget,
      generateImage: async () => {
        n += 1
        return {
          ok: true,
          path: `src/assets/generated/img-${n}.ts`,
          content: buildAssetModule('x', 'image/png', 'a'),
          mimeType: 'image/png',
        }
      },
    })

    for (let i = 0; i < 3; i++) {
      const out = await tools.generate_image.execute!(
        { prompt: `photo ${i}`, description: `asset ${i}`, path: `img-${i}` },
        { toolCallId: `call-${i}`, messages: [] }
      )
      expect(String(out)).toContain('Generated image')
    }

    const fourth = await tools.generate_image.execute!(
      { prompt: 'photo 4', description: 'asset 4' },
      { toolCallId: 'call-4', messages: [] }
    )
    expect(String(fourth)).toContain('Image limit reached')
    expect(writes).toHaveLength(3)
    expect(imageBudget.count).toBe(3)
    expect(Object.keys(fileMap).filter((key) => key.startsWith('src/assets/generated/'))).toHaveLength(3)
  })
})
