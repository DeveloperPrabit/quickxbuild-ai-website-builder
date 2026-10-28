import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

export default function Admin() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: "",
    sku: "",
    price: "",
    cost: "",
    stock: "",
    description: "",
    image: undefined as File | undefined,
  });
  const [error, setError] = useState("");

  // Admin can view all products
  const { data: productsData, refetch } = useQuery({
    queryKey: ["admin-products"],
    queryFn: () => api.listProducts(),
  });

  const createProduct = useMutation({
    mutationFn: async () => {
      setError("");
      if (!form.name || !form.sku || !form.price || !form.cost) {
        setError("Fill all required fields.");
        throw new Error("Fill required fields.");
      }
      let imageFileId;
      if (form.image) {
        const { file } = await api.uploadFile(form.image);
        imageFileId = file.id;
      }
      return api.createProduct({
        name: form.name,
        sku: form.sku,
        price: parseInt(form.price, 10),
        cost: parseInt(form.cost, 10),
        stock: form.stock ? parseInt(form.stock, 10) : undefined,
        description: form.description,
        imageFileId,
      });
    },
    onSuccess: () => {
      setForm({ name: "", sku: "", price: "", cost: "", stock: "", description: "", image: undefined });
      queryClient.invalidateQueries({ queryKey: ["admin-products"] });
      refetch();
    },
    onError: (err: any) => {
      setError(err?.message || "Product save failed");
    },
  });

  // TODO: Add CRUD operations as needed (update, delete etc.)
  // Focus on visible Save button, create and list for now.

  return (
    <div className="max-w-2xl mx-auto py-8">
      <h1 className="text-2xl font-semibold mb-4">Admin Dashboard - Manage Products</h1>
      <Card className="p-4 mb-8">
        <h2 className="font-medium mb-2">New Product</h2>
        <form onSubmit={e => { e.preventDefault(); createProduct.mutate(); }}>
          <div className="space-y-2">
            <Input
              placeholder="Name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
            <Input
              placeholder="SKU"
              value={form.sku}
              onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
              required
            />
            <Input
              placeholder="Price"
              type="number"
              value={form.price}
              onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
              required
            />
            <Input
              placeholder="Cost"
              type="number"
              value={form.cost}
              onChange={(e) => setForm((f) => ({ ...f, cost: e.target.value }))}
              required
            />
            <Input
              placeholder="Stock (optional)"
              type="number"
              value={form.stock}
              onChange={(e) => setForm((f) => ({ ...f, stock: e.target.value }))}
            />
            <Input
              placeholder="Description (optional)"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
            <Input
              type="file"
              accept="image/*"
              onChange={e => setForm(f => ({ ...f, image: e.target.files?.[0] }))}
            />
          </div>
          <Button
            type="submit"
            className="mt-4 w-full"
            disabled={createProduct.isPending}
          >
            {createProduct.isPending ? "Saving..." : "Save Product"}
          </Button>
        </form>
        {error && <div className="mt-2 text-destructive text-sm">{error}</div>}
      </Card>
      <h2 className="font-medium mb-2">All Products</h2>
      <div className="space-y-2">
        {productsData?.products?.length === 0 ? (
          <div className="text-gray-500">No products yet.</div>
        ) : (
          productsData?.products?.map((p) => (
            <Card key={p.id} className="p-4 flex flex-col mb-2">
              <div className="font-semibold">{p.name}</div>
              <div className="text-xs text-gray-500">SKU: {p.sku}</div>
              <div className="">Price: ${p.price}</div>
              <div className="">Cost: ${p.cost}</div>
              <div className="">Stock: {p.stock}</div>
              <div className="">{p.description}</div>
              {p.imageFileId && <img src={'/api/files/' + p.imageFileId} alt={p.name} className="mt-2 w-32 h-32 object-cover rounded" />}
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
