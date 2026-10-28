import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getProduct, listProducts } from '@/lib/api'

type Props = { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const product = await getProduct(id)
  if (!product) {
    return { title: 'Product' }
  }
  return {
    title: product.name,
    description: product.description || `${product.name} (${product.sku})`,
  }
}

export async function generateStaticParams() {
  const products = await listProducts()
  return products.map((product) => ({ id: product.id }))
}

export default async function ProductPage({ params }: Props) {
  const { id } = await params
  const product = await getProduct(id)
  if (!product) {
    notFound()
  }
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 32 }}>
      <h1>{product.name}</h1>
      <p>{product.description}</p>
      <p>{product.price} {product.currency} · SKU {product.sku}</p>
    </main>
  )
}
