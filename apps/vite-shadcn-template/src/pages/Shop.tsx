import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export default function Shop() {
  const {
    data,
    isLoading,
    error,
    refetch
  } = useQuery({
    queryKey: ['products'],
    queryFn: api.listProducts
  });

  return (
    <div className="max-w-5xl mx-auto mt-8 px-2">
      <h1 className="text-3xl font-bold mb-6">Store</h1>
      {isLoading && <p>Loading...</p>}
      {error && <div className="text-red-500 p-2">{error instanceof Error ? error.message : 'Failed to load products'}</div>}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {data?.products?.length
          ? data.products.map(product => (
            <div key={product.id} className="border rounded-lg p-4 bg-white shadow hover:shadow-lg transition">
              {product.imageFileId && <img src={"/api/files/" + product.imageFileId} alt={product.name} className="w-full mb-2 object-contain h-40" />}
              <h2 className="text-xl font-semibold mb-1">{product.name}</h2>
              <div className="mb-1 text-sm text-muted-foreground">SKU: {product.sku}</div>
              <div className="mb-2 font-bold text-lg text-indigo-700">{product.price / 100} {product.currency?.toUpperCase()}</div>
              <div className="text-sm mb-1">{product.description}</div>
              <div className="text-xs text-muted-foreground mb-1">Stock: {product.stock}</div>
            </div>
          ))
          : !isLoading && <div className="text-muted-foreground">No products yet.</div>}
      </div>
    </div>
  );
}
