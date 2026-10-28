import { describe, expect, it } from 'vitest'
import { inferCompleteness } from '../design/completeness'
import { analyzeProductBlueprint } from '../design/product-blueprint'
import { extractPromptColors, extractPromptPages } from '../design/prompt-pages'

const BARBER_BRIEF = `Act as an expert Senior Frontend Developer and UI/UX Designer. Generate a complete, production-ready, fully responsive 4-page website layout for a premium, high-end grooming brand named "Insane Barber".

### GENERAL DESIGN SYSTEMS & DESIGN TOKENS:
- Color Palette:
  * Primary Background: Deep Charcoal (#1A1A1A)
  * Secondary Background: Matte Slate Black (#0E0E0E)
  * Primary Typography: Stark Off-White (#F5F5F5)
  * Accent Brand Color: Electric Neon Crimson (#E50914)
- Navigation Header (Global): Minimalist top sticky navbar. Left-aligned bold uppercase text logo "INSANE BARBER". Right-aligned clean text navigation links: Home, About, Services, Contact. Rightmost CTA Button: "Book a Chair" in solid electric crimson.

### PAGE 1: HOME PAGE
- HERO SECTION: "Precision Fades. Bold Attitude." Our shop strips away the corporate clutter.

### PAGE 2: ABOUT PAGE
- HEADER SECTION: "The Madness Behind the Method"

### PAGE 3: SERVICES PAGE
- HEADER SECTION: "The Grooming Menu"

### PAGE 4: CONTACT PAGE
- Location: "Chandragiri, Bagmati Province, Nepal"
- Submit Action Button: "Confirm Chair Reservation"
`

describe('prompt-driven pages', () => {
  it('reads PAGE N headings from a brief', () => {
    expect(extractPromptPages(BARBER_BRIEF)).toEqual([
      { path: '/', title: 'Home' },
      { path: '/about', title: 'About' },
      { path: '/services', title: 'Services' },
      { path: '/contact', title: 'Contact' },
    ])
  })

  it('reads a navigation or pages list when there are no headings', () => {
    expect(extractPromptPages('Build a bakery site. Pages: Home, Menu, Order Online and Contact.')).toEqual([
      { path: '/', title: 'Home' },
      { path: '/menu', title: 'Menu' },
      { path: '/order-online', title: 'Order Online' },
      { path: '/contact', title: 'Contact' },
    ])
    expect(extractPromptPages('build a gym website named PeakFit')).toEqual([])
  })

  it('reads role-labelled hex colors', () => {
    expect(extractPromptColors(BARBER_BRIEF)).toEqual({
      background: '#1A1A1A',
      foreground: '#F5F5F5',
      accent: '#E50914',
    })
  })

  it('builds the blueprint from the brief instead of a keyword template', () => {
    const bp = analyzeProductBlueprint(BARBER_BRIEF)!
    expect(bp.brandName).toBe('Insane Barber')
    expect(bp.vertical).not.toBe('travel')
    expect(bp.pages.map((p) => p.path)).toEqual(['/', '/about', '/services', '/contact'])
    expect(bp.backend.auth).toBe(false)
    expect(bp.colorHints).toEqual({ background: '#1A1A1A', foreground: '#F5F5F5', accent: '#E50914' })
  })

  it('keeps the completeness checklist to the pages the user asked for', () => {
    const paths = inferCompleteness(BARBER_BRIEF).map((item) => item.path)
    expect(paths).toEqual(expect.arrayContaining(['/', '/about', '/services', '/contact']))
    expect(paths).not.toContain('/destinations')
    expect(paths).not.toContain('/login')
  })
})
