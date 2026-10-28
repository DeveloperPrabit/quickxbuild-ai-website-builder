import type { MetadataRoute } from 'next'
import { listProducts } from '@/lib/api'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.APP_URL || 'http://localhost:3005'
  const products = await listProducts()
  return [
    { url: base, changeFrequency: 'daily', priority: 1 },
    { url: `${base}/products`, changeFrequency: 'daily', priority: 0.8 },
    ...products.map((product) => ({
      url: `${base}/products/${product.id}`,
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    })),
  ]
}
