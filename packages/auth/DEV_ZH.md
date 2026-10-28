# @quickxbuild/auth 开发文档

基于 better-auth 框架构建的综合身份验证和授权解决方案，专为 Cloudflare Workers 环境优化，集成 Stripe 支付处理功能。

## 目录

- [概述](#概述)
- [项目结构](#项目结构)
- [API 参考](#api-参考)
- [环境配置](#环境配置)
- [测试](#测试)
- [配置选项](#配置选项)
- [TypeScript 类型定义](#typescript-类型定义)
- [插件](#插件)
- [最佳实践](#最佳实践)
- [故障排除](#故障排除)

## 概述

`@quickxbuild/auth` 是 QuickXBuild 项目的核心身份验证包，提供完整的用户认证、授权和订阅管理功能。

### 核心特性

- **🔐 身份验证与授权**: 完整的用户认证系统，支持多种登录方式和 OAuth 第三方登录
- **💳 Stripe 集成**: 完整的订阅生命周期管理和支付处理
- **☁️ Cloudflare 优化**: 专为 Cloudflare Workers 环境构建
- **🗄️ 数据库管理**: 使用 Drizzle ORM 和 D1 数据库支持
- **📧 邮件系统**: 自动化邮件通知系统
- **🔒 安全保护**: 会话管理、CSRF 防护和 OAuth nonce 验证
- **🏢 组织管理**: 多租户组织和团队管理
- **🪝 Webhook 处理**: 完整的第三方服务集成 Webhook 处理

### 技术栈

- **框架**: better-auth (基于最新稳定版本)
- **数据库**: Drizzle ORM + Cloudflare D1
- **支付**: Stripe API
- **邮件**: Resend + React Email 模板
- **运行环境**: Cloudflare Workers
- **类型安全**: TypeScript 5+

### 版本兼容性

| 组件 | 支持版本 | 说明 |
|------|----------|------|
| better-auth | 最新稳定版 | 核心认证框架 |
| Drizzle ORM | 最新版本 | 数据库 ORM |
| TypeScript | 5.0+ | 类型安全支持 |
| Bun | 1.0+ | 推荐的运行时环境 |
| Node.js | 18+ | 替代运行时环境 |
| Cloudflare Workers | 最新运行时 | 生产环境 |

## 项目结构

### 目录结构

```
packages/auth/
├── auth-client.ts              # 客户端配置
├── auth-server.ts              # 服务端配置
├── db/                         # 数据库模块
│   ├── index.ts               # 数据库连接
│   ├── schema.ts              # 数据库模式定义
│   ├── schema/                # 数据库模式文件
│   └── migrations/            # 数据库迁移文件
├── plugins/                    # 插件模块
│   ├── captcha-plugin.ts      # 验证码插件
│   ├── email-otp-plugin.ts    # 邮箱 OTP 插件
│   ├── organization-plugin.ts # 组织管理插件
│   ├── stripe-plugin.ts       # Stripe 插件
│   └── stripe/                # Stripe 插件子模块
├── utils/                      # 工具函数
│   ├── admin-utils.ts         # 管理员工具
│   ├── email-service.ts       # 邮件服务
│   ├── email.ts               # 邮件工具
│   ├── nonce.ts               # OAuth nonce 验证
│   ├── organization-utils.ts  # 组织工具
│   ├── stripe-config.ts       # Stripe 配置
│   ├── subscription-limits.ts # 订阅限制（主入口）
│   ├── subscription-limits/   # 订阅限制子模块
│   ├── subscription-utils.ts  # 订阅工具
│   └── __tests__/             # 工具函数测试
├── webhooks/                   # Webhook 处理
│   ├── stripe-handler.ts      # Stripe Webhook 处理
│   ├── handlers/              # 其他 Webhook 处理
│   ├── shared/                # 共享 Webhook 工具
│   └── utils/                 # Webhook 工具函数
├── env.mjs                     # 环境变量配置
├── plugins.ts                  # 插件配置
├── vitest.config.ts           # 测试配置
├── wrangler.jsonc             # Cloudflare Workers 配置
└── package.json               # 包配置文件
```

### 核心结构

#### 1. 服务端配置 (`auth-server.ts`)

```typescript
import { withCloudflare } from '@quickxbuild/better-auth-cloudflare'
import { betterAuth } from 'better-auth'
import { plugins } from './plugins'

async function authBuilder() {
  const dbInstance = await getAuthDb()
  const { env } = await getCloudflareContext({ async: true })
  
  return betterAuth(
    withCloudflare(
      {
        autoDetectIpAddress: true,
        geolocationTracking: true,
        d1: { db: dbInstance },
        kv: env.KV,
      },
      {
        plugins: plugins,
        socialProviders: {
          github: {
            clientId: process.env.BETTER_GITHUB_CLIENT_ID,
            clientSecret: process.env.BETTER_GITHUB_CLIENT_SECRET,
          },
        },
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
      }
    )
  )
}
```

#### 2. 客户端配置 (`auth-client.ts`)

```typescript
import { createAuthClient } from 'better-auth/client'
import { organizationClient } from 'better-auth/client/plugins'
import { stripeClient } from '@quickxbuild/better-auth-stripe/client'

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_AUTH_URL || 'http://localhost:3000',
  plugins: [
    organizationClient(),
    stripeClient(),
  ],
})

// 导出常用客户端 API
export const {
  signIn,
  signOut,
  signUp,
  useSession,
  getSession,
} = authClient
```

## API 参考

### 服务端 API

#### `initAuth()`

初始化认证实例

```typescript
import { initAuth } from '@quickxbuild/auth'

const auth = await initAuth()
export default auth.handler
```

#### `getAuthDb()`

获取数据库连接

```typescript
import { getAuthDb } from '@quickxbuild/auth/db'

const db = await getAuthDb()
```

### 客户端 API

#### 身份验证

```typescript
import { signIn, signOut, signUp } from '@quickxbuild/auth/auth-client'

// 邮箱登录
await signIn.email({
  email: 'user@example.com',
  password: 'password123'
})

// GitHub OAuth 登录
await signIn.social({
  provider: 'github',
  callbackURL: '/dashboard'
})

// 登出
await signOut()

// 注册
await signUp.email({
  email: 'user@example.com',
  password: 'password123',
  name: 'User Name'
})
```

#### 会话管理

```typescript
import { useSession } from '@quickxbuild/auth/auth-client'

function MyComponent() {
  const { data: session, isPending } = useSession()
  
  if (isPending) return <div>Loading...</div>
  if (!session) return <div>Please sign in</div>
  
  return <div>Welcome, {session.user.name}!</div>
}
```

### 组织 API

#### 组织管理

```typescript
import { authClient } from '@quickxbuild/auth/auth-client'
import { getActiveOrganization } from '@quickxbuild/auth/utils/organization-utils'

// 创建组织（使用客户端 API）
const { data: org, error } = await authClient.organization.create({
  name: 'My Company',
  slug: 'my-company'
})

// 获取当前活跃组织（服务端工具函数）
const activeOrg = await getActiveOrganization(userId)

// 切换组织（使用客户端 API）
await authClient.organization.setActive({
  organizationId: organizationId
})

// 或者使用 slug 切换
await authClient.organization.setActive({
  organizationSlug: 'my-company'
})
```

### Stripe API

#### 订阅管理

```typescript
import { 
  getSubscriptionUsage,
  checkAndUpdateAIMessageUsage,
  checkAndUpdateEnhanceUsage 
} from '@quickxbuild/auth/utils/subscription-limits'

// 获取订阅使用情况
const usage = await getSubscriptionUsage(organizationId)
console.log(`AI Messages: ${usage.aiNums}/${usage.aiNumsLimit}`)

// 检查 AI 消息使用限制
const canUse = await checkAndUpdateAIMessageUsage(organizationId, 1)
if (!canUse) {
  throw new Error('AI message limit exceeded')
}
```

#### 支付处理

```typescript
import { createCheckoutSession } from '@quickxbuild/auth/utils/stripe-config'

// 创建支付会话
const session = await createCheckoutSession({
  organizationId,
  priceId: 'price_1234567890',
  successUrl: '/success',
  cancelUrl: '/cancel'
})

// 跳转支付页面
window.location.href = session.url
```

## 环境配置

### 环境变量配置

```env
# 必需 - GitHub OAuth
BETTER_GITHUB_CLIENT_ID=your_github_client_id
BETTER_GITHUB_CLIENT_SECRET=your_github_client_secret

# 可选 - Stripe 支付 (订阅功能必需)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# 必需 - Cloudflare
CLOUDFLARE_ACCOUNT_ID=your_account_id
DATABASE_ID=your_d1_database_id
CLOUDFLARE_API_TOKEN=your_api_token

# 必需 - 安全
TURNSTILE_SECRET_KEY=your_turnstile_secret

# 可选 - 管理员
ADMIN_USER_IDS=user1,user2,user3
```

### Cloudflare Workers 配置

#### wrangler.toml

```toml
name = "quickxbuild-auth"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[vars]
AUTH_SECRET = "your-secret-key"
AUTH_URL = "https://your-app.workers.dev"

# D1 数据库
[[d1_databases]]
binding = "DATABASE"
database_name = "quickxbuild-auth"
database_id = "your-database-id"

# KV 存储
[[kv_namespaces]]
binding = "KV"
id = "your-kv-namespace-id"

# R2 存储 (可选)
[[r2_buckets]]
binding = "BUCKET"
bucket_name = "quickxbuild-uploads"
```

### 数据库迁移

```bash
# 生成数据库迁移
bun run db:generate

# 执行迁移
bun run db:migrate

# 查看数据库
bun run db:studio
```

## 测试

### 身份验证测试

```typescript
import { describe, it, expect } from 'vitest'
import { authClient } from '../auth-client'

describe('Authentication', () => {
  it('should sign in with email', async () => {
    const result = await authClient.signIn.email({
      email: 'test@example.com',
      password: 'password123'
    })

    expect(result.data?.session).toBeDefined()
    expect(result.data?.user.email).toBe('test@example.com')
  })

  it('should handle invalid credentials', async () => {
    const result = await authClient.signIn.email({
      email: 'test@example.com',
      password: 'wrongpassword'
    })

    expect(result.error).toBeDefined()
  })
})
```

### 组织管理测试

```typescript
import { describe, it, expect } from 'vitest'
import { authClient } from '@quickxbuild/auth/auth-client'
import { getActiveOrganization } from '@quickxbuild/auth/utils/organization-utils'

describe('Organization Management', () => {
  it('should create organization', async () => {
    const { data: org, error } = await authClient.organization.create({
      name: 'Test Org',
      slug: 'test-org'
    })

    expect(error).toBeNull()
    expect(org?.name).toBe('Test Org')
    expect(org?.slug).toBe('test-org')
  })

  it('should get active organization', async () => {
    const org = await getActiveOrganization('user-id')
    expect(org).toBeDefined()
    expect(org.id).toBeDefined()
  })
})
```

### Stripe 集成测试

```typescript
import { describe, it, expect } from 'vitest'
import { getSubscriptionUsage, checkAndUpdateAIMessageUsage } from '../utils/subscription-limits'

describe('Subscription Management', () => {
  it('should get subscription usage', async () => {
    const usage = await getSubscriptionUsage('org-id')

    expect(usage.aiNums).toBeGreaterThanOrEqual(0)
    expect(usage.aiNumsLimit).toBeGreaterThan(0)
  })

  it('should check AI message usage', async () => {
    const canUse = await checkAndUpdateAIMessageUsage('org-id', 1)
    expect(typeof canUse).toBe('boolean')
  })
})
```

## 配置选项

### 插件配置

```typescript
// plugins.ts
export const plugins = [
  admin({
    defaultRole: 'user',
    adminRoles: ["admin", "superadmin"],
    adminUserIds: getAdminUserIds(),
  }),
  captchaPlugin,
  emailOTPPlugin,
  ...stripePlugin,
  organizationPlugin,
  emailHarmony(),
  bearer(),
]
```

### 数据库钩子

```typescript
databaseHooks: {
  session: {
    create: {
      before: async (session: Session) => {
        // 自动关联组织
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
  user: {
    create: {
      after: async (user) => {
        // 发送欢迎邮件
        await sendWelcomeEmail(user.email, user.name)
      },
    },
  },
}
```

## TypeScript 类型定义

### 会话类型扩展

```typescript
declare module "better-auth" {
  interface Session {
    activeOrganizationId?: string
    country?: string
    region?: string
  }

  interface User {
    role?: string
    organizationId?: string
  }
}
```

### 自定义类型

```typescript
export interface SubscriptionUsage {
  aiNums: number
  aiNumsLimit: number
  projectNums: number
  projectNumsLimit: number
  seats: number
  seatsLimit: number
  plan: string
}

export interface OrganizationData {
  id: string
  name: string
  slug: string
  stripeCustomerId?: string
  subscriptionId?: string
}
```

## 插件

### 自定义插件开发

```typescript
// plugins/custom-plugin.ts
import { createAuthPlugin } from 'better-auth'

export const customPlugin = createAuthPlugin({
  id: 'custom',
  endpoints: {
    customEndpoint: createAuthEndpoint(
      '/custom/action',
      { method: 'POST' },
      async (ctx) => {
        // 自定义逻辑
        return ctx.json({ success: true })
      }
    ),
  },
  hooks: {
    after: [
      {
        matcher: (context) => context.path === '/sign-in/email',
        handler: async (ctx) => {
          // 登录后处理
          console.log('User signed in:', ctx.session?.userId)
        },
      },
    ],
  },
})
```

### 插件集成

```typescript
// 在 auth-server.ts 中集成
import { customPlugin } from './plugins/custom-plugin'

const authConfig = {
  plugins: [
    ...plugins,
    customPlugin,
  ],
}
```

## 最佳实践

### 错误处理

```typescript
// 统一错误处理
export async function safeAuthAction<T>(
  action: () => Promise<T>
): Promise<[T | null, Error | null]> {
  try {
    const result = await action()
    return [result, null]
  } catch (error) {
    console.error('Auth action failed:', error)
    return [null, error as Error]
  }
}

// 使用示例
const [session, error] = await safeAuthAction(() =>
  authClient.getSession()
)

if (error) {
  // 处理错误
  return
}

// 使用 session
```

### 性能优化

```typescript
// 会话缓存
let cachedSession: Session | null = null
let cacheExpiry = 0

export async function getCachedSession(): Promise<Session | null> {
  const now = Date.now()

  if (cachedSession && now < cacheExpiry) {
    return cachedSession
  }

  const session = await authClient.getSession()
  cachedSession = session.data
  cacheExpiry = now + 5 * 60 * 1000 // 5分钟缓存

  return cachedSession
}
```

### 安全最佳实践

```typescript
// CSRF 保护
export const authConfig = {
  csrf: {
    enabled: true,
    sameSite: 'strict',
  },
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 60 * 60 * 24 * 7, // 7天
    },
  },
  rateLimit: {
    window: 60, // 1分钟
    max: 10,    // 最多10次请求
  },
}
```

## 故障排除

### 常见问题

#### 1. 认证失败

**问题**: 用户无法登录
**解决方案**:
```typescript
// 检查环境变量
if (!process.env.BETTER_GITHUB_CLIENT_ID) {
  throw new Error('Missing BETTER_GITHUB_CLIENT_ID')
}

// 检查数据库连接
try {
  const db = await getAuthDb()
  console.log('Database connected successfully')
} catch (error) {
  console.error('Database connection failed:', error)
}
```

#### 2. 订阅限制问题

**问题**: 订阅限制检查失败
**解决方案**:
```typescript
// 调试订阅状态
const usage = await getSubscriptionUsage(organizationId)
console.log('Subscription debug:', {
  plan: usage.plan,
  limits: {
    ai: `${usage.aiNums}/${usage.aiNumsLimit}`,
    projects: `${usage.projectNums}/${usage.projectNumsLimit}`,
  },
})
```

#### 3. Webhook 处理失败

**问题**: Stripe Webhook 事件处理失败
**解决方案**:
```typescript
// 验证 Webhook 签名
import { stripe } from '@quickxbuild/auth/utils/stripe-config'

export async function verifyWebhook(request: Request) {
  const signature = request.headers.get('stripe-signature')
  const body = await request.text()

  try {
    const event = stripe.webhooks.constructEvent(
      body,
      signature!,
      process.env.STRIPE_WEBHOOK_SECRET!
    )
    return event
  } catch (error) {
    console.error('Webhook verification failed:', error)
    throw new Error('Invalid webhook signature')
  }
}
```

### 调试工具

```typescript
// 启用调试日志
export const authConfig = {
  logger: {
    level: 'debug',
    disabled: process.env.NODE_ENV === 'production',
  },
}

// 自定义日志记录
import { log } from '@quickxbuild/common'

export function logAuthEvent(event: string, data: any) {
  log.auth('info', event, {
    timestamp: new Date().toISOString(),
    ...data,
  })
}
```
```

