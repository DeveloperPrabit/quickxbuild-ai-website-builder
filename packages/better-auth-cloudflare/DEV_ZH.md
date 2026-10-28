# @quickxbuild/better-auth-cloudflare 开发文档

> Cloudflare Workers 环境下的 Better Auth 集成插件

## 概述

`@quickxbuild/better-auth-cloudflare` 是专为 Cloudflare Workers 环境设计的 Better Auth 集成插件，提供 Cloudflare D1 数据库和 KV 存储支持。该插件充分利用 Cloudflare 的边缘计算能力，为 quickxbuild 项目提供高性能、低延迟的身份验证服务。

### 核心特性

- **🌍 地理位置追踪**: 自动检测用户地理位置信息
- **🗄️ D1 数据库集成**: 支持 Cloudflare D1 作为主数据库
- **⚡ KV 存储支持**: 利用 Cloudflare KV 进行缓存
- **🔍 真实 IP 检测**: 通过 Cloudflare Headers 获取真实 IP
- **🚀 边缘优化**: 专为边缘计算环境优化的 Better Auth 配置

## 架构设计

### 整体架构

```
                    quickxbuild 项目架构
                ┌─────────────────┐
   apps/web     │   apps/cdn      │   apps/dispatcher
   (Next.js)    │   (Hono Worker) │   (Hono Worker)
                └─────────┬───────┘
                          │
              @quickxbuild/better-auth-cloudflare
                ┌─────────┼───────┐
   withCloudflare│  cloudflare()  │  createKVStorage()
   (配置助手)    │  (插件核心)    │  (KV 存储适配器)
                └─────────┼───────┘
                          │
                    Better Auth 核心
                ┌─────────┼───────┐
   Session      │   Database      │   Plugins
   Management   │   Adapter       │   System
                └─────────┼───────┘
                          │
                 Cloudflare 基础设施
                ┌─────────┼───────┐
   D1 Database  │   KV Storage    │   Workers Runtime
   (主数据库)   │   (缓存存储)    │   (运行环境)
                └─────────────────┘
```

### 核心组件

#### 1. `withCloudflare()` - 配置助手
将 Better Auth 配置适配到 Cloudflare 环境，自动配置数据库适配器和 KV 存储。

#### 2. `cloudflare()` - 插件核心
提供地理位置追踪、IP 检测等 Cloudflare 特有功能。

#### 3. `createKVStorage()` - KV 适配器
将 Better Auth 的 SecondaryStorage 接口适配到 Cloudflare KV 存储。

#### 4. `cloudflareClient()` - 客户端插件
为客户端提供类型安全的 Cloudflare 功能访问。

## 快速开始

### 1. 安装依赖

确保在 Cloudflare Workers 环境中安装：

```bash
# 安装核心依赖
bun add @quickxbuild/better-auth-cloudflare better-auth
bun add -D @cloudflare/workers-types

# 配置 wrangler.toml 中的绑定
```

### 2. Cloudflare 绑定配置

在 `wrangler.toml` 中配置数据库和 KV 绑定：

```toml
# D1 数据库绑定
[[d1_databases]]
binding = "DATABASE"
database_name = "quickxbuild-auth"
database_id = "your-database-id"

# KV 存储绑定
[[kv_namespaces]]
binding = "KV"
id = "your-kv-namespace-id"
```

### 3. TypeScript 类型定义

创建 `worker-configuration.d.ts` 文件：

```typescript
interface Env {
  DATABASE: D1Database
  KV: KVNamespace
  // 其他环境变量
}

declare global {
  namespace CloudflareEnv {
    interface Env extends Env {}
  }
}
```

## 核心 API 参考

### `withCloudflare(cloudflareOptions, betterAuthOptions)`

**类型定义:**
```typescript
export const withCloudflare = (
  cloudFlareOptions: WithCloudflareOptions,
  options: BetterAuthOptions
): BetterAuthOptions
```

**参数:**
- `cloudflareOptions`: Cloudflare 特定配置
- `betterAuthOptions`: 标准 Better Auth 配置

**配置选项:**

```typescript
interface WithCloudflareOptions {
  // 自动检测 IP 地址 (默认: true)
  autoDetectIpAddress?: boolean

  // 启用地理位置追踪 (默认: true)
  geolocationTracking?: boolean

  // D1 数据库配置
  d1?: {
    db: ReturnType<typeof drizzle>
    options?: Omit<DrizzleAdapterConfig, "provider">
  }

  // KV 存储配置
  kv?: KVNamespace
}
```

**使用示例 (参考 `packages/auth/auth-server.ts`):**

```typescript
import { withCloudflare } from '@quickxbuild/better-auth-cloudflare'
import { betterAuth } from 'better-auth'
import { getCloudflareContext } from '@opennextjs/cloudflare'

async function authBuilder() {
  const dbInstance = await getAuthDb()
  const { env } = await getCloudflareContext({ async: true })

  return betterAuth(
    withCloudflare(
      {
        autoDetectIpAddress: true,
        geolocationTracking: true,
        d1: {
          db: dbInstance,
          options: {
            // usePlural: true,
            // debugLogs: true,
          },
        },
        kv: env.KV,
      },
      {
        databaseHooks: {
          session: {
            create: {
              before: async (session: Session) => {
                const organization = await getActiveOrganization(session.userId)
                return {
                  data: {
                    ...session,
                    activeOrganizationId: organization.id,
                  },
                }
              },
            },
          },
        },
        socialProviders: {
          github: {
            clientId: process.env.BETTER_GITHUB_CLIENT_ID,
            clientSecret: process.env.BETTER_GITHUB_CLIENT_SECRET,
          },
        },
        plugins: [
          admin(),
          organization(),
          emailOTP(),
          stripe(),
          emailHarmony(),
          bearer(),
        ],
      }
    )
  )
}
```

### `cloudflare(options?)` - 插件核心

**类型定义:**
```typescript
export const cloudflare = (options?: CloudflarePluginOptions): BetterAuthPlugin
```

**功能特性:**

1. **地理位置端点**: `GET /cloudflare/geolocation`
   - 获取当前用户地理位置信息
   - 返回国家和地区数据

2. **数据库字段**: 自动添加地理位置数据库字段
   - `country`: 国家代码
   - `region`: 地区代码

**实现示例 (参考 `index.ts`):**

```typescript
endpoints: {
  getGeolocation: createAuthEndpoint(
    "/cloudflare/geolocation",
    { method: "GET" },
    async ctx => {
      const session = ctx.context?.session
      if (!session) {
        return ctx.json({ error: "Unauthorized" }, { status: 401 })
      }

      const cf = getCloudflareContext().cf
      if (!cf) {
        return ctx.json({ error: "Cloudflare context is not available" }, { status: 404 })
      }

      const context: CloudflareGeolocation = {
        country: cf.country as string,
        region: cf.region as string,
      }

      return ctx.json(context)
    }
  ),
}
```

### `createKVStorage(kv)` - KV 存储适配器

**类型定义:**
```typescript
export const createKVStorage = (kv: KVNamespace<string>): SecondaryStorage
```

**实现原理 (参考 `index.ts`):**

```typescript
export const createKVStorage = (kv: KVNamespace<string>): SecondaryStorage => {
  return {
    get: async (key: string) => {
      return kv.get(key)
    },
    set: async (key: string, value: string, ttl?: number) => {
      return kv.put(key, value, ttl ? { expirationTtl: ttl } : undefined)
    },
    delete: async (key: string) => {
      return kv.delete(key)
    },
  }
}
```

### `getGeolocation()` - 地理位置获取

**类型定义:**
```typescript
export const getGeolocation = (): CloudflareGeolocation | undefined
```

**返回数据结构:**
```typescript
interface CloudflareGeolocation {
  country: string  // 国家代码 (如: "US", "CN")
  region: string   // 地区代码 (如: "CA", "BJ")
}
```

### `cloudflareClient()` - 客户端插件

**使用示例:**

```typescript
import { createAuthClient } from "better-auth/client"
import { cloudflareClient } from "@quickxbuild/better-auth-cloudflare/client"

export const authClient = createAuthClient({
  baseURL: "https://your-app.workers.dev",
  plugins: [cloudflareClient()],
})

// 获取地理位置信息
const geolocation = await authClient.cloudflare.getGeolocation()
```

## 实际使用示例

### 1. 标准 Worker 应用

**Hono Worker 示例 (参考 `apps/cdn/src/auth-server.ts`):**

```typescript
import { betterAuth } from "better-auth"
import { withCloudflare } from "@quickxbuild/better-auth-cloudflare"
import { getAuthDb } from "./db"
import type { AppContext } from './types'

async function authBuilder(c: AppContext) {
  const dbInstance = await getAuthDb(c)

  return betterAuth(
    withCloudflare(
      {
        autoDetectIpAddress: true,
        geolocationTracking: true,
        d1: {
          db: dbInstance,
          options: {},
        },
        kv: c.env.KV,
      },
      {
        socialProviders: {
          github: {
            clientId: process.env.BETTER_GITHUB_CLIENT_ID,
            clientSecret: process.env.BETTER_GITHUB_CLIENT_SECRET,
          },
        },
        plugins: []
      }
    )
  )
}

let authInstance: Awaited<ReturnType<typeof authBuilder>> | null = null

export async function initAuth(c: AppContext) {
  if (!authInstance) {
    authInstance = await authBuilder(c)
  }
  return authInstance
}
```

### 2. 仅 KV 存储配置

**类型安全配置示例 (参考 `apps/dispatcher/src/auth.ts`):**

```typescript
import { withCloudflare } from "@quickxbuild/better-auth-cloudflare"

const authOptions = withCloudflare(
  {
    autoDetectIpAddress: true,
    geolocationTracking: true,
    // 仅使用 KV 存储，不配置 D1
    kv: c.env.KV,
    // 可选的 D1 配置（如果环境中存在）
    ...(c.env.DATABASE && {
      d1: {
        db: c.env.DATABASE,
        options: {},
      },
    }),
  },
  {
    socialProviders: {
      github: {
        clientId: env.BETTER_GITHUB_CLIENT_ID,
        clientSecret: env.BETTER_GITHUB_CLIENT_SECRET,
      },
    },
    plugins: [], // 添加所需插件
  }
)
```

### 3. 中间件集成

```typescript
import { validateSession } from "./auth"

export async function authMiddleware(c: any, next: any) {
  const session = await validateSession(c)

  if (!session) {
    return c.json({ error: "Unauthorized" }, 401)
  }

  // 记录用户地理位置信息
  console.log("User location:", {
    country: session.country,
    region: session.region
  })

  c.set('session', session)
  await next()
}
```

### 4. 客户端地理位置获取

```typescript
import { authClient } from "./auth-client"

async function getUserLocation() {
  try {
    const location = await authClient.cloudflare.getGeolocation()
    console.log("Current user location:", location)
    return location
  } catch (error) {
    console.error("Failed to get location:", error)
    return null
  }
}
```

## 与 quickxbuild 项目集成

### 与现有包的集成

#### 1. @quickxbuild/auth 包集成

```typescript
// packages/auth/auth-server.ts 中的集成
import { withCloudflare } from '@quickxbuild/better-auth-cloudflare'
import { plugins } from './plugins'

const authConfig = withCloudflare(cloudflareOptions, {
  plugins: plugins, // 使用 @quickxbuild/auth/plugins
  // 其他配置...
})
```

#### 2. @quickxbuild/db 包集成

```typescript
import { getAuthDb } from '@quickxbuild/auth/db'
import { withCloudflare } from '@quickxbuild/better-auth-cloudflare'

const db = await getAuthDb()
const authConfig = withCloudflare({
  d1: { db, options: {} }
}, baseConfig)
```

#### 3. @quickxbuild/common 日志集成

```typescript
import { log } from '@quickxbuild/common'

// 在数据库钩子中添加日志记录
databaseHooks: {
  session: {
    create: {
      before: async (session: Session) => {
        log.auth('info', 'Session created', {
          userId: session.userId,
          country: session.country,
          operation: 'session_create',
        })
        return { data: session }
      },
    },
  },
}
```

### 性能优化配置

**共享实例管理:**

```typescript
// 避免重复初始化认证实例
let sharedAuthInstance: any = null

export async function getSharedAuth(context: any) {
  if (!sharedAuthInstance) {
    sharedAuthInstance = await initAuth(context)
  }
  return sharedAuthInstance
}

// 在路由中使用
app.use('/api/auth/*', async (c, next) => {
  const auth = await getSharedAuth(c)
  c.set('auth', auth)
  await next()
})
```

## 常见问题解决

### 环境问题

#### 1. Cloudflare 上下文不可用

**错误信息:** `Cloudflare context is not available`

**解决方案:**
```typescript
// 确保在 Cloudflare Workers 环境中运行
try {
  const cf = getCloudflareContext().cf
  if (!cf) {
    throw new Error("Not running in Cloudflare Workers")
  }
} catch (error) {
  console.warn("Cloudflare context unavailable, using fallback")
  // 使用备用方案
}
```

#### 2. KV 绑定错误

**错误信息:** `KV is not defined`

**解决方案:**
```typescript
// 检查 wrangler.toml 配置
[[kv_namespaces]]
binding = "KV"
id = "your-kv-namespace-id"

// 在代码中验证绑定
if (!c.env.KV) {
  throw new Error("KV binding not configured")
}
```

#### 3. D1 数据库连接失败

**错误信息:** `Database connection failed`

**解决方案:**
```typescript
// 确保数据库迁移已运行
bun migration:local

// 检查 D1 绑定配置
[[d1_databases]]
binding = "DATABASE"
database_name = "quickxbuild-auth"
database_id = "your-database-id"

// 在代码中处理连接错误
try {
  const db = await getAuthDb(c)
  return db
} catch (error) {
  console.error("Database connection failed:", error)
  throw error
}
```

#### 4. 地理位置数据缺失

**现象:** 会话中 `country`, `region` 字段为空

**排查步骤:**
```typescript
// 1. 确认插件配置
const plugin = cloudflare({
  geolocationTracking: true, // 确保启用
})

// 2. 检查 Cloudflare Headers
const headers = c.req.raw.headers
console.log("CF-IPCountry:", headers.get("cf-ipcountry"))
console.log("CF-Ray:", headers.get("cf-ray"))

// 3. 验证数据库钩子
databaseHooks: {
  session: {
    create: {
      before: async (s: any) => {
        console.log("Session before hook:", s)
        const cf = (await getCloudflareContext({ async: true })).cf
        console.log("CF context:", cf)
        return s
      },
    },
  },
}
```

### 调试技巧

#### 启用详细日志

```typescript
const authConfig = withCloudflare(
  {
    d1: {
      db: dbInstance,
      options: {
        debugLogs: true, // 启用 Drizzle 调试日志
      },
    },
  },
  {
    // Better Auth 配置
  }
)
```

#### 环境变量验证

```typescript
// 在应用启动时验证必需的环境变量
function validateEnvironment(env: any) {
  const required = [
    'BETTER_GITHUB_CLIENT_ID',
    'BETTER_GITHUB_CLIENT_SECRET'
  ]

  for (const key of required) {
    if (!env[key]) {
      throw new Error(`Missing required environment variable: ${key}`)
    }
  }
}
```

## 开发和扩展指南

### 本地开发

#### 1. 项目设置

```bash
# 克隆项目
git clone https://github.com/your-org/quickxbuild.git
cd quickxbuild

# 安装依赖
bun install

# 进入包目录
cd packages/better-auth-cloudflare

# 运行类型检查
bun typecheck

# 构建
bun build
```

#### 2. 目录结构

```
packages/better-auth-cloudflare/
├── index.ts          # 主要导出和核心 API
├── client.ts         # 客户端插件
├── types.ts          # TypeScript 类型定义
├── schema.ts         # 数据库模式定义
├── package.json      # 包配置
├── tsconfig.json     # TypeScript 配置
├── tsup.config.ts    # 构建配置
└── DEV_ZH.md        # 开发文档
```

#### 3. 代码规范

**文件头注释:**
```typescript
/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * filename.ts
 * Copyright (C) 2025 Nextify Limited
 */
```

**导入顺序:**
```typescript
// 1. 外部依赖
import type { KVNamespace } from "@cloudflare/workers-types"
import { betterAuth } from "better-auth"

// 2. 内部依赖
import { log } from "@quickxbuild/common"

// 3. 相对导入
import { schema } from "./schema"
import type { CloudflareOptions } from "./types"
```

**类型定义规范:**
```typescript
// 使用 interface 定义配置选项
export interface CloudflarePluginOptions {
  /**
   * 选项描述
   * @default defaultValue
   */
  optionName?: boolean
}

// 使用 type 定义联合类型
export type CloudflareEnvironment = "production" | "staging" | "development"
```

#### 4. 测试编写

```typescript
// 单元测试
describe("withCloudflare", () => {
  it("should configure D1 database adapter", () => {
    const config = withCloudflare(
      { d1: { db: mockDb } },
      { plugins: [] }
    )
    expect(config.database).toBeDefined()
  })
})

// 集成测试
describe("cloudflare plugin", () => {
  it("should extract geolocation from request", async () => {
    const plugin = cloudflare()
    // 测试地理位置提取逻辑
  })
})
```

### 功能扩展

#### 1. 增强地理位置功能

```typescript
// 1. 扩展类型定义 (types.ts)
export interface CloudflareGeolocation {
  country: string
  region: string
  // 新增字段
  latitude?: string
  longitude?: string
}

// 2. 更新数据库模式 (schema.ts)
const geolocationFields: GeolocationFields = {
  country: { type: "string", required: false, input: false },
  region: { type: "string", required: false, input: false },
}

// 3. 更新插件逻辑 (index.ts)
init(init_ctx) {
  return {
    options: {
      databaseHooks: {
        session: {
          create: {
            before: async (s: any) => {
              const cf = (await getCloudflareContext({ async: true })).cf
              s.country = cf?.country
              s.region = cf?.region
              s.latitude = cf?.latitude
              s.longitude = cf?.longitude
              return s
            },
          },
        },
      },
    },
  }
}
```

#### 2. 添加存储适配器

```typescript
// 支持 R2 存储适配器
export const createR2Storage = (r2: R2Bucket): CustomStorage => {
  return {
    upload: async (key: string, data: ArrayBuffer) => {
      return r2.put(key, data)
    },
    download: async (key: string) => {
      const object = await r2.get(key)
      return object?.arrayBuffer()
    },
    delete: async (key: string) => {
      return r2.delete(key)
    },
  }
}
```

### 性能优化

#### 1. 缓存优化

```typescript
// 使用内存缓存减少重复初始化
let authInstance: any = null

export async function getAuth(c: any) {
  if (!authInstance) {
    authInstance = await initAuth(c)
  }
  return authInstance
}

// KV 缓存优化
export const createOptimizedKVStorage = (kv: KVNamespace): SecondaryStorage => {
  const cache = new Map<string, string>()

  return {
    get: async (key: string) => {
      // 内存缓存
      if (cache.has(key)) {
        return cache.get(key)
      }

      const value = await kv.get(key)
      if (value) {
        cache.set(key, value)
      }
      return value
    },
    // ... 其他方法
  }
}
```

#### 2. 错误处理

```typescript
// 使用统一错误处理
import { tryCatch } from '@quickxbuild/common'

export async function safeInitAuth(c: any) {
  const [auth, error] = await tryCatch(async () => {
    return await initAuth(c)
  })

  if (error) {
    log.auth('error', 'Auth initialization failed', {}, error)
    throw new Error('Failed to initialize authentication')
  }

  return auth
}
```

#### 3. 类型安全

```typescript
// 增强类型安全性
export function withCloudflare<T extends BetterAuthOptions>(
  cloudflareOptions: WithCloudflareOptions,
  options: T
): T & { database?: any; secondaryStorage?: any } {
  // 实现逻辑...
}

// 类型守卫函数
function isValidGeolocation(data: unknown): data is CloudflareGeolocation {
  return (
    typeof data === 'object' &&
    data !== null &&
    'country' in data &&
    'region' in data
  )
}
```
