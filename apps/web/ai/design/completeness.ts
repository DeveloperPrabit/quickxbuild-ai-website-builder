import { extractPromptPages } from './prompt-pages'

export type CompletenessKind = 'marketing' | 'auth' | 'app' | 'shell'

export type CompletenessItem = {
  id: string
  path: string
  title: string
  kind: CompletenessKind
}

const FULL_BUILD =
  /\b(website|web ?app|saas|landing|marketing|clone|mockup|screenshot|exactly like|build (me )?(an? |the )?(app|site|product))\b/i

export function isFullProductBuild(prompt: string, hasDesign = false): boolean {
  if (hasDesign) {
    return true
  }
  return FULL_BUILD.test(prompt) || (/\b(create|build|generate|implement)\b/i.test(prompt) &&
    /\b(page|site|app|dashboard|admin|home)\b/i.test(prompt))
}

/**
 * Screen checklist for full product builds only.
 * Bug fixes / small edits must NOT get this â€” it forces the model to rebuild every page
 * and often ends with zero file writes.
 */
export function inferCompleteness(
  prompt: string,
  extraPaths: string[] = [],
  options: { force?: boolean; hasDesign?: boolean } = {}
): CompletenessItem[] {
  if (!options.force && !isFullProductBuild(prompt, options.hasDesign)) {
    return []
  }

  const text = prompt.toLowerCase()
  const items: CompletenessItem[] = [
    {
      id: 'home',
      path: '/',
      title: 'Home with finished layout, not a stub',
      kind: 'marketing',
    },
    {
      id: 'shell',
      path: 'src/App.tsx',
      title: 'App shell routes and nav to every page',
      kind: 'shell',
    },
  ]

  const add = (item: CompletenessItem) => {
    if (!item.path || item.path === '.' || item.path === './') {
      return
    }
    if (items.some((existing) => existing.path === item.path)) {
      return
    }
    items.push(item)
  }

  const promptPages = extractPromptPages(prompt)
  for (const page of promptPages) {
    if (page.path === '/') continue
    add({
      id: page.path.replace(/\W+/g, '-').replace(/^-+|-+$/g, ''),
      path: page.path,
      title: page.title,
      kind: 'marketing',
    })
  }

  if (promptPages.length === 0) {
    if (/\b(pric(e|ing)|plan|plans)\b/.test(text)) {
      add({ id: 'pricing', path: '/pricing', title: 'Pricing', kind: 'marketing' })
    }
    if (/\b(about)\b/.test(text)) {
      add({ id: 'about', path: '/about', title: 'About', kind: 'marketing' })
    }
    if (/\b(contact)\b/.test(text)) {
      add({ id: 'contact', path: '/contact', title: 'Contact', kind: 'marketing' })
    }
    if (/\b(destination|destinations|travel|trek|tour|tours)\b/.test(text)) {
      add({ id: 'destinations', path: '/destinations', title: 'Destinations', kind: 'marketing' })
      add({ id: 'packages', path: '/packages', title: 'Tour packages', kind: 'marketing' })
      add({ id: 'about', path: '/about', title: 'About', kind: 'marketing' })
      add({ id: 'contact', path: '/contact', title: 'Contact', kind: 'marketing' })
      add({ id: 'login', path: '/login', title: 'Login', kind: 'auth' })
      add({ id: 'signup', path: '/signup', title: 'Signup', kind: 'auth' })
    }
    if (/\b(gym|fitness|workout|crossfit|training studio)\b/.test(text)) {
      add({ id: 'about', path: '/about', title: 'About', kind: 'marketing' })
      add({ id: 'classes', path: '/classes', title: 'Classes', kind: 'marketing' })
      add({ id: 'pricing', path: '/pricing', title: 'Pricing', kind: 'marketing' })
      add({ id: 'contact', path: '/contact', title: 'Contact', kind: 'marketing' })
      add({ id: 'login', path: '/login', title: 'Login', kind: 'auth' })
      add({ id: 'signup', path: '/signup', title: 'Signup', kind: 'auth' })
    }
    if (/\b(restaurant|cafe|bistro|menu)\b/.test(text)) {
      add({ id: 'menu', path: '/menu', title: 'Menu', kind: 'marketing' })
      add({ id: 'about', path: '/about', title: 'About', kind: 'marketing' })
      add({ id: 'contact', path: '/contact', title: 'Contact', kind: 'marketing' })
    }
    if (/\b(agency|consulting)\b/.test(text)) {
      add({ id: 'services', path: '/services', title: 'Services', kind: 'marketing' })
      add({ id: 'about', path: '/about', title: 'About', kind: 'marketing' })
      add({ id: 'contact', path: '/contact', title: 'Contact', kind: 'marketing' })
    }
    if (/\b(portfolio|designer|photographer)\b/.test(text)) {
      add({ id: 'work', path: '/work', title: 'Work', kind: 'marketing' })
      add({ id: 'about', path: '/about', title: 'About', kind: 'marketing' })
      add({ id: 'contact', path: '/contact', title: 'Contact', kind: 'marketing' })
    }
    if (/\b(shop|catalog|storefront|ecommerce|e-commerce)\b/.test(text)) {
      add({ id: 'shop', path: '/shop', title: 'Catalog', kind: 'app' })
    }
    if (/\b(dashboard|analytics)\b/.test(text)) {
      add({ id: 'dashboard', path: '/dashboard', title: 'Dashboard', kind: 'app' })
    }
    if (/\b(admin)\b/.test(text)) {
      add({ id: 'admin', path: '/admin', title: 'Admin', kind: 'app' })
    }
  }
  if (/\b(login|signup|sign up|auth|register)\b/.test(text)) {
    add({ id: 'login', path: '/login', title: 'Login', kind: 'auth' })
    add({ id: 'signup', path: '/signup', title: 'Signup', kind: 'auth' })
  }

  // SEO / design shell defaults for full product builds
  add({
    id: 'seo-html',
    path: 'index.html',
    title: 'SEO title and meta description in index.html',
    kind: 'shell',
  })
  add({
    id: 'design-css',
    path: 'src/index.css',
    title: 'Design tokens and global styles',
    kind: 'shell',
  })

  for (const path of extraPaths) {
    const trimmed = (path || '').trim()
    if (!trimmed || trimmed === '.' || trimmed === './') {
      continue
    }
    const clean = trimmed.startsWith('/') || trimmed.startsWith('src/') ? trimmed : `/${trimmed}`
    add({
      id: clean.replace(/\W+/g, '-').replace(/^-+|-+$/g, '') || 'screen',
      path: clean,
      title: `Screen ${clean}`,
      kind: clean.startsWith('src/') ? 'shell' : 'app',
    })
  }

  return items
}

export function formatCompletenessXml(items: CompletenessItem[]): string {
  if (items.length === 0) {
    return ''
  }
  const rows = items.map((item) => `${item.path} â€” ${item.title}`).join('\n')
  return `<completeness>
Ship every item. No stub pages, no TODO, no lorem. Wire each path in src/App.tsx and the nav.
${rows}
</completeness>`
}

export function writesCoverCompleteness(
  files: string[],
  items: CompletenessItem[]
): { ok: boolean; missing: string[] } {
  const normalized = files.map((file) => file.replace(/^\.\//, '').toLowerCase())
  const missing = items.filter((item) => !coversPath(normalized, item.path)).map((item) => item.path)
  return { ok: missing.length === 0, missing }
}

function coversPath(files: string[], path: string): boolean {
  const clean = path.replace(/^\.\//, '').toLowerCase()
  if (clean === 'src/app.tsx') {
    return files.some((file) => file.endsWith('src/app.tsx') || file === 'app.tsx')
  }
  if (clean === '/') {
    return files.some((file) =>
      /(pages\/(index|home)|src\/app\.tsx|app\/page)/.test(file)
    )
  }
  const slug = clean.replace(/^\//, '').replace(/\//g, '-')
  return files.some((file) => file.includes(slug) || file.includes(clean.replace(/^\//, '')))
}
