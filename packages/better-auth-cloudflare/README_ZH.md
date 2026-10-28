# @quickxbuild/better-auth-cloudflare

> 支持地理位置跟踪和 D1/KV 存储的 Better Auth Cloudflare 边缘集成插件

[![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](../../LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)

专为 Cloudflare 生态系统设计的 Better Auth 集成插件，利用边缘计算能力和全球网络基础设施实现超低延迟身份验证，内置地理位置跟踪功能。

## 📋 目录

- [功能特性](#-功能特性)
- [安装](#-安装)
- [快速开始](#️-快速开始)
- [API 参考](#-api-参考)
- [地理位置功能](#-地理位置功能)
- [数据库集成](#️-数据库集成)
- [KV 存储](#-kv-存储)
- [部署](#-部署)
- [隐私与安全](#-隐私与安全)
- [性能](#-性能)
- [故障排除](#-故障排除)
- [高级用法](#-高级用法)
- [贡献](#-贡献)

## 🚀 功能特性

- **🌍 地理位置跟踪** - 自动用户位置检测（国家、地区、城市、时区）
- **🔍 真实 IP 检测** - 使用 Cloudflare 头部（`cf-connecting-ip`、`x-real-ip`）准确识别 IP
- **🗄️ D1 数据库集成** - 与 Drizzle ORM 无缝集成的 Cloudflare D1 SQLite 数据库支持
- **⚡ KV 存储** - 使用 Cloudflare KV 的高性能边缘缓存
- **🚀 边缘优化** - 专为 Cloudflare Workers 运行时构建
- **🔧 简单设置** - `withCloudflare` 助手简化配置
- **🛡️ 隐私优先** - 可配置的地理位置跟踪和隐私控制
- **📊 会话增强** - 自动使用位置数据丰富会话

## 📦 安装

> **注意**：这是 QuickXBuild monorepo 内的内部包，不会发布到 npm。

### 在 QuickXBuild 项目中

```bash
# 在 monorepo 根目录安装依赖
bun install

# 该包作为工作区依赖自动可用
# 添加到你的 package.json 依赖中：
"@quickxbuild/better-auth-cloudflare": "*"
```

### 外部项目

如果你想在 QuickXBuild monorepo 之外使用此包，需要安装所需的依赖：

```bash
# 核心依赖
bun add better-auth@^1.3.1 @opennextjs/cloudflare@^1.5.1

# 开发依赖
bun add -D @cloudflare/workers-types@^4.20250719.0

# 数据库依赖（如果使用 D1）
bun add drizzle-orm@latest
```

### 前置要求

- **Cloudflare Workers** 账户和 CLI (`wrangler`)
- **Better Auth** v1.3.1 或更高版本
- **Node.js** 18+ 或 **Bun** 运行时

## 🏃‍♂️ 快速开始

### 1. Cloudflare 设置

创建你的 `wrangler.toml` 配置：

```toml
# wrangler.toml
name = "my-auth-app"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[vars]
AUTH_SECRET = "your-secret-key"
AUTH_URL = "https://my-auth-app.yourdomain.workers.dev"

# D1 数据库（可选）
[[d1_databases]]
binding = "DB"
database_name = "auth-db"
database_id = "your-d1-database-id"

# KV 存储（可选）
[[kv_namespaces]]
binding = "CACHE"
id = "your-kv-namespace-id"
```

### 2. 数据库设置 (D1)

```bash
# 创建 D1 数据库
wrangler d1 create auth-db

# 应用 Better Auth 迁移
wrangler d1 migrations apply auth-db --local
```

### 3. 认证配置

```typescript
// src/auth.ts
import { betterAuth } from "better-auth"
import { drizzle } from "drizzle-orm/d1"
import { withCloudflare } from "@quickxbuild/better-auth-cloudflare"

export const auth = betterAuth(
  withCloudflare(
    {
      // D1 数据库配置（可选）
      d1: {
        db: drizzle(env.DB)
      },
      // KV 存储配置（可选）
      kv: env.CACHE,
      // 地理位置跟踪（默认：true）
      geolocationTracking: true,
      // 自动 IP 检测（默认：true）
      autoDetectIpAddress: true,
    },
    {
      secret: env.AUTH_SECRET,
      baseURL: env.AUTH_URL,
      // 在这里添加你的认证提供商
      providers: {
        // github: { ... },
        // google: { ... },
      },
    }
  )
)
```

### 4. Workers 入口点

```typescript
// src/index.ts
import { auth } from "./auth"

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return auth.handler(request)
  },
} satisfies ExportedHandler<Env>

export interface Env {
  AUTH_SECRET: string
  AUTH_URL: string
  DB?: D1Database  // 如果使用 D1 则可选
  CACHE?: KVNamespace  // 如果使用 KV 则可选
}
```

### 5. 客户端集成

```typescript
// src/auth-client.ts
import { createAuthClient } from "better-auth/client"
import { cloudflareClient } from "@quickxbuild/better-auth-cloudflare/client"

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_AUTH_URL!,
  plugins: [cloudflareClient()],
})

// 导出认证方法以便使用
export const { signIn, signOut, useSession } = authClient
```

## 📚 API 参考

### `withCloudflare(cloudflareOptions, authOptions)`

使用 Cloudflare 特定功能增强 Better Auth 配置。

**参数：**

- `cloudflareOptions: WithCloudflareOptions` - Cloudflare 特定配置
- `authOptions: BetterAuthOptions` - 标准 Better Auth 配置

**返回：** `BetterAuthOptions` - 为 Cloudflare 增强的配置

### `cloudflare(options?)`

为 Better Auth 创建 Cloudflare 插件。

**参数：**

- `options?: CloudflarePluginOptions` - 插件配置

**返回：** `BetterAuthPlugin` - Cloudflare 插件实例

### `createKVStorage(kv)`

使用 Cloudflare KV 创建二级存储适配器。

**参数：**

- `kv: KVNamespace` - Cloudflare KV 命名空间

**返回：** `SecondaryStorage` - KV 存储适配器

### `getGeolocation()`

从 Cloudflare 上下文检索地理位置数据。

**返回：** `CloudflareGeolocation | undefined` - 位置数据或 undefined

### 配置选项

```typescript
interface WithCloudflareOptions {
  // D1 数据库配置
  d1?: {
    db: ReturnType<typeof drizzle>
    options?: Omit<DrizzleAdapterConfig, "provider">
  }

  // KV 存储配置
  kv?: KVNamespace

  // 自动检测 IP 地址（默认：true）
  autoDetectIpAddress?: boolean

  // 在会话中跟踪地理位置（默认：true）
  geolocationTracking?: boolean
}
```

## 🌍 地理位置功能

### 自动会话增强

启用地理位置跟踪时，会话会自动包含位置数据：

```typescript
import type { SessionWithGeolocation } from "@quickxbuild/better-auth-cloudflare"

interface SessionWithGeolocation extends Session {
  country?: string    // "US", "CN", "GB"
  region?: string     // "California", "Beijing", "London"
}
```

### 访问用户位置

```typescript
// 通过 API 端点获取当前用户的地理位置
const getUserLocation = async () => {
  const response = await fetch('/api/auth/cloudflare/geolocation')
  if (!response.ok) {
    throw new Error('Failed to get location')
  }
  const location = await response.json()
  return location // { country: "US", region: "CA" }
}

// 在你的应用中使用
try {
  const location = await getUserLocation()
  console.log(`用户位于 ${location.country}, ${location.region}`)
} catch (error) {
  console.error('位置不可用:', error)
}
```

### 服务端位置访问

```typescript
// 在你的 Cloudflare Worker 中
import { getGeolocation } from "@quickxbuild/better-auth-cloudflare"

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const location = getGeolocation()
      console.log('用户位置:', location)
    } catch (error) {
      console.log('位置不可用')
    }

    return auth.handler(request)
  }
}
```

### 实际应用

```typescript
// 基于位置的内容适配
const getLocalizedContent = (country?: string) => {
  // 根据国家返回本地化内容
  return country ? `${country} 的内容` : '默认内容'
}

// 基于国家的本地化内容
const getLocalizedContent = (country?: string) => {
  const localization = {
    'US': { currency: 'USD', language: 'en-US', flag: '🇺🇸' },
    'CN': { currency: 'CNY', language: 'zh-CN', flag: '🇨🇳' },
    'JP': { currency: 'JPY', language: 'ja-JP', flag: '🇯🇵' },
    'GB': { currency: 'GBP', language: 'en-GB', flag: '🇬🇧' },
    'DE': { currency: 'EUR', language: 'de-DE', flag: '🇩🇪' },
  }
  return localization[country as keyof typeof localization] || localization['US']
}

// 可疑登录的安全监控
const detectSuspiciousLogin = (
  current: SessionWithGeolocation,
  previous: SessionWithGeolocation[]
) => {
  if (!current.country || previous.length === 0) return false

  const lastSession = previous[0]
  if (lastSession?.country && current.country !== lastSession.country) {
    console.warn(`检测到可疑登录: ${lastSession.country} → ${current.country}`)
    return true
  }
  return false
}
```

## 🗄️ 数据库集成

### D1 数据库设置

```bash
# 创建 D1 数据库
wrangler d1 create auth-db

# 获取数据库 ID 并更新 wrangler.toml
# 从输出中复制 database_id

# 应用 Better Auth 迁移（本地开发）
wrangler d1 migrations apply auth-db --local

# 应用迁移到生产环境
wrangler d1 migrations apply auth-db

# 查询数据库进行测试
wrangler d1 execute auth-db --command="SELECT * FROM session LIMIT 5"
```

### 数据库配置

```typescript
// src/db.ts
import { drizzle } from "drizzle-orm/d1"
import { withCloudflare } from "@quickxbuild/better-auth-cloudflare"

// 使用 D1 配置
export const auth = betterAuth(
  withCloudflare(
    {
      d1: {
        db: drizzle(env.DB),
        // 可选：自定义表前缀
        options: {
          schema: {
            // 如果需要，自定义表名
            user: "custom_users",
            session: "custom_sessions",
          }
        }
      }
    },
    {
      secret: env.AUTH_SECRET,
      baseURL: env.AUTH_URL,
    }
  )
)
```

### 自定义模式扩展

插件会自动使用地理位置字段扩展会话表。你也可以创建自定义表：

```typescript
// src/schema.ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

// 带有位置偏好的扩展用户表
export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  preferredCountry: text("preferred_country"),
  registrationCountry: text("registration_country"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
})

// 位置历史跟踪表
export const locationHistory = sqliteTable("location_history", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id),
  country: text("country").notNull(),
  region: text("region"),
  ipAddress: text("ip_address"), // 匿名化 IP
  loginAt: integer("login_at", { mode: "timestamp" }).notNull(),
})

// 在你的应用中使用
export const db = drizzle(env.DB, { schema: { user, locationHistory } })
```

## ⚡ KV 存储

### 设置 KV 命名空间

```bash
# 创建 KV 命名空间
wrangler kv:namespace create "CACHE"

# 用于预览（开发）
wrangler kv:namespace create "CACHE" --preview

# 添加到 wrangler.toml
[[kv_namespaces]]
binding = "CACHE"
id = "your-kv-namespace-id"
preview_id = "your-preview-kv-namespace-id"
```

### KV 存储配置

```typescript
// 使用 KV 存储配置
export const auth = betterAuth(
  withCloudflare(
    {
      kv: env.CACHE, // 用于二级存储的 KV 命名空间
    },
    {
      secret: env.AUTH_SECRET,
      baseURL: env.AUTH_URL,
    }
  )
)
```

### 直接使用 KV 存储

```typescript
import { createKVStorage } from "@quickxbuild/better-auth-cloudflare"

// 创建 KV 存储适配器
const kvStorage = createKVStorage(env.CACHE)

// 缓存用户偏好
await kvStorage.set(
  `user:${userId}:preferences`,
  JSON.stringify(preferences),
  3600 // 1 小时 TTL（秒）
)

// 获取缓存数据
const cachedPreferences = await kvStorage.get(`user:${userId}:preferences`)
const preferences = cachedPreferences ? JSON.parse(cachedPreferences) : null

// 删除缓存数据
await kvStorage.delete(`user:${userId}:preferences`)
```

### 使用 KV 进行速率限制

```typescript
const checkRateLimit = async (ip: string, kv: KVNamespace) => {
  const key = `rate_limit:${ip}`
  const current = await kv.get(key)

  if (!current) {
    // 第一次请求
    await kv.put(key, "1", { expirationTtl: 60 }) // 1 分钟窗口
    return { allowed: true, remaining: 4 }
  }

  const count = parseInt(current, 10)
  const limit = 5 // 每分钟 5 次请求

  if (count >= limit) {
    return { allowed: false, remaining: 0 }
  }

  // 增加计数器
  await kv.put(key, (count + 1).toString(), { expirationTtl: 60 })
  return { allowed: true, remaining: limit - count - 1 }
}

// 在你的 Worker 中使用
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const ip = request.headers.get('cf-connecting-ip') || 'unknown'
    const rateLimit = await checkRateLimit(ip, env.CACHE)

    if (!rateLimit.allowed) {
      return new Response('超出速率限制', { status: 429 })
    }

    return auth.handler(request)
  }
}
```

## 🚀 部署

### 开发环境

```bash
# 全局安装 Wrangler CLI
npm install -g wrangler
# 或使用 bun
bun add -g wrangler

# 登录到 Cloudflare
wrangler login

# 启动本地开发服务器
wrangler dev

# 测试认证端点
curl http://localhost:8787/api/auth/session
curl http://localhost:8787/api/auth/cloudflare/geolocation
```

### 生产部署

```bash
# 部署到 Cloudflare Workers
wrangler deploy

# 设置环境密钥
wrangler secret put AUTH_SECRET
# 在提示时输入你的密钥

# 如果需要，设置其他密钥
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET

# 监控部署日志
wrangler tail

# 检查部署状态
wrangler deployments list
```

### 环境变量

```bash
# 在 wrangler.toml 中设置环境变量
[vars]
AUTH_URL = "https://your-worker.your-subdomain.workers.dev"
NODE_ENV = "production"

# 或通过 CLI 设置
wrangler secret put AUTH_SECRET
wrangler secret put DATABASE_URL  # 如果使用外部数据库
```

## 🔧 故障排除

### 常见问题

#### 1. "Cloudflare 上下文不可用"

**问题：** 地理位置端点返回 404 错误。

**解决方案：**

```typescript
// 确保你在 Cloudflare Workers 环境中运行
// 检查 @opennextjs/cloudflare 是否正确配置

// 在开发中，模拟 Cloudflare 上下文
if (process.env.NODE_ENV === 'development') {
  // 为本地开发模拟 CF 对象
  globalThis.cf = {
    country: 'US',
    region: 'California'
  }
}
```

#### 2. 数据库连接问题

**问题：** D1 数据库查询失败或超时。

**解决方案：**

```bash
# 检查 D1 数据库状态
wrangler d1 info auth-db

# 验证 wrangler.toml 中的数据库绑定
[[d1_databases]]
binding = "DB"
database_name = "auth-db"
database_id = "your-actual-database-id"

# 测试数据库连接
wrangler d1 execute auth-db --command="SELECT 1"
```

#### 3. KV 存储访问被拒绝

**问题：** KV 操作失败并出现权限错误。

**解决方案：**

```bash
# 检查 KV 命名空间配置
wrangler kv:namespace list

# 验证 wrangler.toml 中的 KV 绑定
[[kv_namespaces]]
binding = "CACHE"
id = "your-actual-kv-id"

# 测试 KV 访问
wrangler kv:key put --binding=CACHE "test" "value"
```

#### 4. 会话不持久化

**问题：** 用户会话在请求之间不持久化。

**解决方案：**

```typescript
// 确保会话存储正确配置
export const auth = betterAuth(
  withCloudflare(
    {
      d1: { db: drizzle(env.DB) }, // 会话持久化所需
      geolocationTracking: true,   // 这启用会话存储
    },
    {
      secret: env.AUTH_SECRET,
      baseURL: env.AUTH_URL,
      session: {
        storeSessionInDatabase: true, // 显式启用
      }
    }
  )
)
```

### 调试模式

启用调试日志进行故障排除：

```typescript
// 添加调试日志
export const auth = betterAuth(
  withCloudflare(
    { /* 你的配置 */ },
    {
      secret: env.AUTH_SECRET,
      baseURL: env.AUTH_URL,
      logger: {
        level: "debug",
        disabled: false,
      }
    }
  )
)
```

## 🔒 隐私与安全

### GDPR 合规

使用隐私优先的默认设置配置插件：

```typescript
// 默认禁用跟踪（隐私优先方法）
export const auth = betterAuth(
  withCloudflare({
    geolocationTracking: false, // 需要明确同意
    autoDetectIpAddress: false, // 禁用 IP 检测
  }, {
    secret: env.AUTH_SECRET,
    baseURL: env.AUTH_URL,
  })
)
```

### 同意管理

为地理位置跟踪实施用户同意：

```typescript
// 用户同意管理
interface UserConsent {
  userId: string
  geolocationConsent: boolean
  ipTrackingConsent: boolean
  consentDate: Date
}

// 在数据库中存储同意
const updateUserConsent = async (consent: UserConsent) => {
  await db.insert(userConsent).values(consent)
}

// 在跟踪前检查同意
const hasGeolocationConsent = async (userId: string): Promise<boolean> => {
  const consent = await db.select()
    .from(userConsent)
    .where(eq(userConsent.userId, userId))
    .limit(1)

  return consent[0]?.geolocationConsent ?? false
}
```

### IP 匿名化

为隐私合规实施 IP 匿名化：

```typescript
// 匿名化 IP 地址
const anonymizeIP = (ip: string): string => {
  if (!ip || ip === 'unknown') return 'anonymous'

  if (ip.includes(":")) {
    // IPv6 - 保留前 64 位（4 组）
    const groups = ip.split(":")
    return groups.slice(0, 4).join(":") + "::"
  } else {
    // IPv4 - 保留前 3 个八位组
    const octets = ip.split(".")
    return octets.slice(0, 3).join(".") + ".0"
  }
}

// 在你的应用中使用
const logSecurityEvent = async (request: Request, event: string) => {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown'
  const anonymizedIP = anonymizeIP(ip)

  await db.insert(securityLog).values({
    event,
    anonymizedIP,
    timestamp: new Date(),
    userAgent: request.headers.get('user-agent'),
  })
}
```

## 📊 性能

### 边缘优化

利用 Cloudflare 的全球网络获得最佳性能：

```typescript
// 在边缘缓存响应
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // 使用 Cloudflare 的缓存 API
    const cache = caches.default
    const cacheKey = new Request(request.url, request)

    // 首先检查缓存
    let response = await cache.match(cacheKey)

    if (!response) {
      response = await auth.handler(request)

      // 缓存成功的响应
      if (response.status === 200) {
        ctx.waitUntil(cache.put(cacheKey, response.clone()))
      }
    }

    return response
  }
}
```

### KV 性能提示

优化 KV 使用以获得更好的性能：

```typescript
// 尽可能批量 KV 操作
const batchKVOperations = async (operations: Array<{key: string, value: string}>, kv: KVNamespace) => {
  const promises = operations.map(op =>
    kv.put(op.key, op.value, { expirationTtl: 3600 })
  )

  await Promise.all(promises)
}

// 使用适当的 TTL 值
const cacheWithTTL = async (key: string, value: string, kv: KVNamespace) => {
  // 频繁变化数据的短 TTL
  if (key.includes('session')) {
    await kv.put(key, value, { expirationTtl: 300 }) // 5 分钟
  }
  // 稳定数据的长 TTL
  else if (key.includes('user-preferences')) {
    await kv.put(key, value, { expirationTtl: 86400 }) // 24 小时
  }
}
```

## 🏗️ 高级用法

### 边缘缓存

```typescript
// 利用 Cloudflare 的边缘缓存
const cache = caches.default
const cacheKey = new Request(request.url, request)

let response = await cache.match(cacheKey)
if (!response) {
  response = await auth.handler(request)
  ctx.waitUntil(cache.put(cacheKey, response.clone()))
}
```

### 地理路由

```typescript
// 基于用户位置的路由
const geoRoute = (request: Request) => {
  const country = request.cf?.country

  switch (country) {
    case 'CN': return handleChinaUsers(request)
    case 'US': return handleUSUsers(request)
    default: return handleDefaultUsers(request)
  }
}
```

### 健康监控

```typescript
// 健康检查端点
const healthCheck = async (env: Env) => {
  const checks = []

  try {
    // 检查 D1 数据库
    if (env.DB) {
      await env.DB.prepare("SELECT 1").first()
      checks.push({ service: "D1", status: "healthy" })
    }

    // 检查 KV 存储
    if (env.KV) {
      await env.KV.put("health", "ok", { expirationTtl: 60 })
      checks.push({ service: "KV", status: "healthy" })
    }

    return Response.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      checks
    })
  } catch (error) {
    return Response.json({
      status: "unhealthy",
      error: error.message,
      timestamp: new Date().toISOString(),
      checks
    }, { status: 500 })
  }
}
```

## 🤝 贡献

我们欢迎贡献！请查看我们的[贡献指南](../../CONTRIBUTING.md)了解详情。

### 开发设置

```bash
# 克隆 QuickXBuild 仓库
git clone https://github.com/quickxbuild-ai/quickxbuild.git
cd quickxbuild

# 为整个 monorepo 安装依赖
bun install

# 导航到包目录
cd packages/better-auth-cloudflare

# 类型检查
bun run typecheck

# 构建包
bun run build

# 运行测试（如果可用）
bun test
```

### 贡献指南

1. **Fork 仓库**并创建功能分支
2. **为新功能编写测试**
3. **遵循 TypeScript 最佳实践**并保持类型安全
4. **更新文档**以反映任何 API 更改
5. **在开发和生产环境中彻底测试**
6. **提交拉取请求**并清楚描述更改

## 📄 许可证

本项目采用 AGPL-3.0 许可证 - 详情请参阅 [LICENSE](../../LICENSE) 文件。

## 🆘 支持

### 文档

- 📖 [开发指南（英文）](./DEV.md) - 全面的开发文档
- 📖 [开发指南（中文）](./DEV_ZH.md) - 完整的中文开发指南
- 📚 [Better Auth 文档](https://better-auth.com) - 官方 Better Auth 文档
- 🌐 [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/) - 官方 Cloudflare 文档

### 社区与支持

- 🐛 [报告问题](https://github.com/quickxbuild-ai/quickxbuild/issues) - 错误报告和功能请求
- 💬 [讨论](https://github.com/quickxbuild-ai/quickxbuild/discussions) - 社区讨论和问答
- 🌐 [Cloudflare 社区](https://community.cloudflare.com/) - Cloudflare 特定帮助
- 📧 [联系我们](mailto:support@quickxbuild.dev) - 企业用户直接支持

### 快速链接

- [Better Auth GitHub](https://github.com/better-auth/better-auth)
- [Cloudflare Workers 示例](https://github.com/cloudflare/workers-examples)
- [Drizzle ORM 文档](https://orm.drizzle.team/)

## 🙏 致谢

此包基于 [better-auth-cloudflare](https://github.com/zpg6/better-auth-cloudflare/) 的原始工作，并为 QuickXBuild 生态系统进行了重大增强和适配。

特别感谢：

- Better Auth 团队创建了出色的身份验证库
- Cloudflare 团队提供了边缘计算平台
- 开源社区的持续改进和反馈

---

由 [QuickXBuild](https://github.com/quickxbuild-ai) 团队用 ❤️ 为边缘而构建。