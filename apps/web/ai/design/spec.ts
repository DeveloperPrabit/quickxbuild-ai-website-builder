import { inferCompleteness, isFullProductBuild } from './completeness'



export type DesignSpec = {

  fileKey?: string

  fileUrl?: string

  theme: {

    background: string

    foreground: string

    accent: string

    font: string

  }

  pages: Array<{

    name: string

    path: string

    frames: Array<{ name: string; role: string; notes: string }>

  }>

  warning?: string

}



const DESIGN_TRIGGERS = [

  'figma',

  'generate design',

  'storefront',

  'look and feel',

  'visual design',

  'cream and black',

  'website',

  'landing',

  'mockup',

  'screenshot',

  'exactly like',

  'clone this',

]



export function needsDesignSpec(prompt: string, isFileEdit = false, hasImage = false): boolean {

  if (isFileEdit) {

    return false

  }

  if (hasImage) {

    return true

  }

  const text = prompt.toLowerCase()

  return DESIGN_TRIGGERS.some((trigger) => text.includes(trigger)) || isFullProductBuild(prompt)

}



export function buildLocalDesignSpec(prompt: string): DesignSpec {

  const text = prompt.toLowerCase()

  const cream = text.includes('cream') || text.includes('beige')

  const dark = text.includes('black') || text.includes('dark')

  const pages = inferCompleteness(prompt, [], { force: true })

    .filter((item) => item.kind !== 'shell')

    .map((item) => ({

      name: item.title,

      path: item.path,

      frames: [{ name: item.title, role: item.kind, notes: 'Finish this screen. No stub.' }],

    }))



  return {

    theme: {

      background: cream ? '#F6F1E7' : dark ? '#111111' : '#FFFFFF',

      foreground: dark && !cream ? '#F5F5F5' : '#171717',

      accent: text.includes('gold') ? '#C6A15B' : '#111111',

      font: 'ui-sans-serif',

    },

    pages: pages.length > 0

      ? pages

      : [

          {

            name: 'Home',

            path: '/',

            frames: [{ name: 'Hero', role: 'hero', notes: 'Headline, subcopy, primary CTA' }],

          },

        ],

  }

}



export function formatDesignXml(spec: DesignSpec): string {

  return `<designSpec>

Match this visual system exactly. Do not invent a different look.

${JSON.stringify(spec, null, 2)}

</designSpec>`

}



export function formatDesignMessage(spec: DesignSpec): string {

  const file = spec.fileUrl || spec.fileKey || 'design spec from prompt or uploaded image'

  return `Design locked: ${file}. Map each frame to src/pages + Tailwind. Ship every listed path.`

}

