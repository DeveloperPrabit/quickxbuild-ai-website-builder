import type { Metadata } from 'next'
import Link from 'next/link'
import { listProducts } from '@/lib/api'

export const metadata: Metadata = {
  title: 'Home',
  description: 'Featured products from the generated-app Postgres catalog.',
}

export default async function HomePage() {
  const products = (await listProducts()).slice(0, 3)
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 32 }}>
      <h1>Storefront</h1>
      <p>This Next.js app is SEO HTML. Data comes from the Hono API on :8787.</p>
      <p><Link href="/products">All products</Link></p>
      <ul>
        {products.map((product) => (
          <li key={product.id}>
            <Link href={`/products/${product.id}`}>{product.name}</Link> — {product.price} {product.currency}
          </li>
        ))}
      </ul>
    </main>
  )
}
