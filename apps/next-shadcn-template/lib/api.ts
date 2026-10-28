const API = process.env.APP_API_URL || 'http://127.0.0.1:8787'

export type Product = {
  id: string
  name: string
  sku: string
  price: number
  cost: number
  currency: string
  description: string
}

export async function listProducts(): Promise<Product[]> {
  const response = await fetch(`${API}/api/products`, { next: { revalidate: 30 } })
  if (!response.ok) {
    return []
  }
  const data = await response.json() as { products?: Product[] }
  return data.products || []
}

export async function getProduct(id: string): Promise<Product | null> {
  const response = await fetch(`${API}/api/products/${id}`, { next: { revalidate: 30 } })
  if (!response.ok) {
    return null
  }
  const data = await response.json() as { product?: Product }
  return data.product || null
}
