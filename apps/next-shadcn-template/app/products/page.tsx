import type { Metadata } from 'next'
import Link from 'next/link'
import { listProducts } from '@/lib/api'

export const metadata: Metadata = {
  title: 'Catalog',
  description: 'All products with server-rendered titles for search engines.',
}

export default async function ProductsPage() {
  const products = await listProducts()
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 32 }}>
      <h1>Catalog</h1>
      <ul>
        {products.map((product) => (
          <li key={product.id}>
            <Link href={`/products/${product.id}`}>{product.name}</Link>
          </li>
        ))}
      </ul>
    </main>
  )
}
