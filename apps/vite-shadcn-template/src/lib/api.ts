export type PublicUser = {
  id: string
  email: string
  name: string
  role: string
  disabled: boolean
}

export type Item = {
  id: string
  userId: string
  title: string
  body: string
  createdAt: string
  updatedAt: string
}

export type AppFile = {
  id: string
  userId: string
  path: string
  mime: string
  size: number
  createdAt: string
}

export type Invite = {
  id: string
  email: string
  role: string
  token: string
  expiresAt: string
}

// Fix: always throw proper error message if available
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> || {}),
  }
  // Do not set Content-Type if using FormData
  if (!(init?.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }

  let url = path;
  // Fix: make sure path is relative to the same origin no matter vite port
  if (url.startsWith('/')) {
    url = `${window.location.origin}${url}`;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      credentials: 'include',
      ...init,
      headers,
    });
  } catch (fetchErr: any) {
    throw new Error(fetchErr?.message || 'Request failed: could not connect');
  }

  if (!response) {
    throw new Error('No response from server');
  }

  const isJSON = response.headers.get('content-type')?.includes('application/json')

  let data: any = {};
  if (isJSON) {
    data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error((typeof data === 'object' ? (data.error ?? data.message) : undefined) || response.statusText || 'Request failed');
    }
    return data as T;
  }

  if (!response.ok) {
    throw new Error(response.statusText || 'Request failed');
  }
  // @ts-ignore
  return undefined as T;
}

export const api = {
  me: () => request<{ user: PublicUser }>('/api/me'),
  signup: (body: { email: string; password: string; name: string; inviteToken?: string }) =>
    request<{ user: PublicUser }>('/api/auth/signup', { method: 'POST', body: JSON.stringify(body) }),
  login: (body: { email: string; password: string }) =>
    request<{ user: PublicUser }>('/api/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  forgot: (email: string) =>
    request<{ ok: boolean }>('/api/auth/forgot', { method: 'POST', body: JSON.stringify({ email }) }),
  reset: (token: string, password: string) =>
    request<{ ok: boolean }>('/api/auth/reset', { method: 'POST', body: JSON.stringify({ token, password }) }),
  oauthStatus: () => request<{ google: boolean; github: boolean }>('/api/auth/oauth'),
  listItems: () => request<{ items: Item[] }>('/api/items'),
  createItem: (body: { title: string; body: string }) =>
    request<{ item: Item }>('/api/items', { method: 'POST', body: JSON.stringify(body) }),
  updateItem: (id: string, body: { title?: string; body?: string }) =>
    request<{ item: Item }>(`/api/items/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteItem: (id: string) => request<{ ok: boolean }>(`/api/items/${id}`, { method: 'DELETE' }),
  listFiles: () => request<{ files: AppFile[] }>('/api/files'),
  uploadFile: (file: File) => {
    const body = new FormData();
    body.append('file', file);
    return request<{ file: AppFile }>('/api/files', { method: 'POST', body });
  },
  adminUsers: () => request<{ users: PublicUser[] }>('/api/admin/users'),
  adminItems: () => request<{ items: Item[] }>('/api/admin/items'),
  adminFiles: () => request<{ files: AppFile[] }>('/api/admin/files'),
  adminInvites: () => request<{ invites: Invite[] }>('/api/admin/invites'),
  adminSchema: () => request<{ schema: string; tables: Record<string, number> }>('/api/admin/schema'),
  adminIntegrations: () => request<{ integrations: Record<string, boolean> }>('/api/admin/integrations'),
  listPayments: () => request<{ payments: Array<{ id: string; provider: string; status: string; amount: number; currency: string; description: string }> }>('/api/payments'),
  checkout: (body: { amount: number; currency?: string; description?: string; provider?: 'stripe' | 'esewa' | 'paytm' | 'khalti'; orderId?: string }) =>
    request<{ payment: { id: string; status: string }; url: string; fields?: Record<string, string> }>('/api/payments/checkout', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  listProducts: () => request<{ products: Array<{ id: string; name: string; sku: string; price: number; cost: number; stock: number; currency: string; description: string; imageFileId?: string }> }>('/api/products'),
  createProduct: (body: { name: string; sku: string; price: number; cost: number; stock?: number; currency?: string; description?: string; imageFileId?: string }) =>
    request<{ product: { id: string } }>('/api/products', { method: 'POST', body: JSON.stringify(body) }),
  createOrder: (body: { items: Array<{ productId: string; qty: number }>; tax?: number; discount?: number }) =>
    request<{ order: { id: string; total: number; status: string } }>('/api/orders', { method: 'POST', body: JSON.stringify(body) }),
  adminAnalytics: () => request<{ revenue: number; cogs: number; margin: number; marginPercent: number; paidOrders: number; topProducts: Array<{ name: string; qty: number; revenue: number }> }>('/api/admin/analytics'),
  adminSuggestedTables: (kind: 'shop' | 'saas' = 'shop') =>
    request<{ kind: string; tables: string[] }>(`/api/admin/suggested-tables?kind=${kind}`),
  createInvite: (body: { email: string; role: 'admin' | 'member' }) =>
    request<{ invite: Invite; url: string }>('/api/admin/invites', { method: 'POST', body: JSON.stringify(body) }),
  patchAdminUser: (id: string, body: { role?: 'owner' | 'admin' | 'member'; disabled?: boolean }) =>
    request<{ user: PublicUser }>(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
}
