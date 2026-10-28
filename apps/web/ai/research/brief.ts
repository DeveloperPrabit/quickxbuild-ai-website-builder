import { z } from 'zod/v4'

/** One HTTP endpoint taken from searched docs */
export type BriefEndpoint = z.infer<typeof BriefEndpoint>
export const BriefEndpoint = z.object({
  method: z.string(),
  path: z.string(),
  purpose: z.string(),
})

/** One third-party provider in a research brief */
export type BriefProvider = z.infer<typeof BriefProvider>
export const BriefProvider = z.object({
  id: z.string(),
  official: z.boolean(),
  urls: z.array(z.string()),
  endpoints: z.array(BriefEndpoint),
  envNames: z.array(z.string()),
  webhookPath: z.string().optional(),
  pitfalls: z.array(z.string()),
})

/** Structured docs brief passed into codegen */
export type IntegrationBrief = z.infer<typeof IntegrationBrief>
export const IntegrationBrief = z.object({
  summary: z.string(),
  providers: z.array(BriefProvider),
  constraints: z.array(z.string()),
  warning: z.string().optional(),
})

const SECRET_PATTERN =
  /(sk_live|sk_test|rk_live|rk_test|whsec_|pk_live|pk_test)_[A-Za-z0-9]+|Bearer\s+[A-Za-z0-9._\-]{16,}|[A-Za-z0-9+/]{40,}={0,2}/g

export function stripSecrets(value: string): string {
  return value.replace(SECRET_PATTERN, '[REDACTED]')
}

export function sanitizeBrief(brief: IntegrationBrief): IntegrationBrief {
  const clean = (text: string) => stripSecrets(text)
  return {
    summary: clean(brief.summary),
    warning: brief.warning ? clean(brief.warning) : undefined,
    constraints: brief.constraints.map(clean),
    providers: brief.providers.map((provider) => ({
      ...provider,
      urls: provider.urls.map(clean),
      envNames: provider.envNames.filter((name) => !SECRET_PATTERN.test(name) && !name.includes('=')),
      webhookPath: provider.webhookPath ? clean(provider.webhookPath) : undefined,
      pitfalls: provider.pitfalls.map(clean),
      endpoints: provider.endpoints.map((endpoint) => ({
        method: clean(endpoint.method),
        path: clean(endpoint.path),
        purpose: clean(endpoint.purpose),
      })),
    })),
  }
}

export function parseIntegrationBrief(raw: string): IntegrationBrief | null {
  const cleaned = stripSecrets(raw.trim())
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/)
  const jsonText = fenced?.[1] || cleaned
  const start = jsonText.indexOf('{')
  const end = jsonText.lastIndexOf('}')
  if (start === -1 || end === -1) {
    return null
  }

  try {
    const parsed = IntegrationBrief.safeParse(JSON.parse(jsonText.slice(start, end + 1)))
    if (!parsed.success) {
      return null
    }
    return sanitizeBrief(parsed.data)
  } catch {
    return null
  }
}

export function formatBriefXml(brief: IntegrationBrief): string {
  return `<integrationDocs>
${JSON.stringify(sanitizeBrief(brief), null, 2)}
</integrationDocs>`
}

export function formatResearchMessage(brief: IntegrationBrief): string {
  const names = brief.providers.map((provider) => provider.id).join(', ') || 'external APIs'
  const urls = brief.providers.flatMap((provider) => provider.urls).slice(0, 5)
  const lines = [
    `Searched ${names} docs.`,
    brief.summary,
    urls.length > 0 ? `Sources: ${urls.join(' | ')}` : '',
    brief.warning ? `Warning: ${brief.warning}` : '',
  ]
  return lines.filter(Boolean).join('\n')
}

export function failedBrief(reason: string, providers: string[] = []): IntegrationBrief {
  return {
    summary: 'Docs search was skipped or failed. Implement from existing project files only. Do not invent payment APIs.',
    providers: providers.map((id) => ({
      id,
      official: false,
      urls: [],
      endpoints: [],
      envNames: [],
      pitfalls: ['Search failed; do not invent secret values or unofficial endpoints.'],
    })),
    constraints: [
      'Do not invent undocumented payment or email APIs.',
      'Never write secret values into source files.',
    ],
    warning: reason,
  }
}
