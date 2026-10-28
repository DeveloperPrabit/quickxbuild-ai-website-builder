---
title: "QuickXBuild 开发文档：Better-auth + Stripe 集成指南"
description: "详细的中文开发文档，涵盖 QuickXBuild 项目中 better-auth 与 Stripe 支付集成的完整实现模式"
version: "1.0"
lastUpdated: "2025-07-30"
---

# QuickXBuild 开发文档：Better-auth + Stripe 集成指南

这是一份详细的中文开发文档，涵盖了 QuickXBuild 项目中 better-auth 与 Stripe 支付集成的完整实现模式。

## 快速导航

- 🚀 [快速开始](#环境配置) - 5分钟快速搭建开发环境
- 🏗️ [架构理解](#架构概览) - 了解系统整体设计
- 💳 [Stripe集成](#stripe-集成实现) - 支付功能实现
- 📊 [配额管理](#配额管理系统) - 订阅配额系统
- 🧪 [测试调试](#测试与开发) - 开发和测试指南

## 目录

1. [架构概览](#架构概览)
2. [环境配置](#环境配置)
3. [数据库架构](#数据库架构)
4. [认证系统配置](#认证系统配置)
5. [Stripe 集成实现](#stripe-集成实现)
6. [配额管理系统](#配额管理系统)
7. [API 路由详解](#api-路由详解)
8. [错误处理模式](#错误处理模式)
9. [测试与开发](#测试与开发)

## 相关文档

- [项目总体架构](../../README_ZH.md#技术架构)
- [API 开发指南](../api/DEV_ZH.md)
- [技术开发规范](../../TECHNICAL_GUIDELINES_ZH.md)
- [通用工具包文档](./README.md)

## 架构概览

QuickXBuild 采用多数据库混合架构 (Multi-Database Hybrid Architecture)，实现强大的订阅管理和配额系统：

```typescript
// 架构组件 (Architecture Components)
- SQLite (Auth DB): 用户认证、组织管理、Stripe 订阅
- PostgreSQL (Project DB): 项目数据、配额限制、使用统计
- Cloudflare D1 + KV: 运行时会话存储
- Better-auth: 认证框架核心
- Stripe: 支付处理和订阅管理
```

### 核心特性

- **混合订阅模式 (Hybrid Subscription Model)**: 支持 FREE 和 PAID 计划并存
- **原子配额扣减 (Atomic Quota Deduction)**: 防止并发条件下的超额使用
- **自动配额刷新 (Auto Quota Refresh)**: FREE 计划每月自动重置配额
- **多租户隔离 (Multi-Tenant Isolation)**: 基于组织的资源隔离
- **事件驱动更新 (Event-Driven Updates)**: Stripe Webhook 触发订阅生命周期事件

## 环境配置

### 必需的环境变量

> 💡 **提示**: 复制 `.env.example` 到 `.env.local` 并填入以下配置

```bash
# Better-auth 认证配置
BETTER_AUTH_SECRET="your-32-char-secret"              # 32位随机字符串，用于JWT签名
BETTER_GITHUB_CLIENT_ID="github-oauth-client-id"      # GitHub OAuth 应用ID
BETTER_GITHUB_CLIENT_SECRET="github-oauth-client-secret" # GitHub OAuth 应用密钥

# Stripe 支付配置
STRIPE_SECRET_KEY="sk_test_..."                       # Stripe 密钥（测试环境以sk_test_开头）
STRIPE_WEBHOOK_SECRET="whsec_..."                     # Stripe Webhook 签名密钥
STRIPE_PUBLISHABLE_KEY="pk_test_..."                  # Stripe 公开密钥（前端使用）

# 数据库配置
DATABASE_URL="postgresql://user:password@localhost:5432/quickxbuild"  # PostgreSQL 连接串（项目数据）
DATABASE="auth.db"                                    # SQLite 文件路径（认证数据）

# 管理员配置
ADMIN_USER_IDS="user1,user2,user3"                   # 逗号分隔的管理员用户ID列表

# Cloudflare 配置（生产环境）
KV_NAMESPACE="your-kv-namespace"                      # Cloudflare KV 命名空间
D1_DATABASE="your-d1-database"                       # Cloudflare D1 数据库名称
```

### 开发环境设置

```bash
# 1. 安装项目依赖
bun install

# 2. 运行数据库迁移（初始化数据库结构）
bun migration:local

# 3. 启动开发服务器（支持热重载）
bun dev

# 4. 运行类型检查（验证TypeScript类型）
bun typecheck

# 5. 运行测试套件
bun test
```

> ⚠️ **注意**: 确保本地已安装 PostgreSQL 数据库并创建了对应的数据库

## 数据库架构

### 认证数据库 (SQLite)

> 📝 **说明**: 认证数据库使用 SQLite，存储用户认证信息、组织数据和 Stripe 订阅记录

```typescript
// packages/auth/db/schema/auth-schema.ts

// User Table - 用户基础信息表
export const user = sqliteTable("user", {
  id: text('id').primaryKey(),                          // User unique identifier
  name: text('name').notNull(),                         // User display name
  email: text('email').notNull().unique(),              // User email (unique)
  emailVerified: integer('email_verified', {mode: 'boolean'}), // Email verification status
  stripeCustomerId: text('stripe_customer_id'),         // Stripe customer ID for billing
  role: text('role').default('user').notNull(),         // User role: user, admin, superadmin
  banned: integer('banned', {mode: 'boolean'}).default(false), // Account ban status
  createdAt: integer('created_at', {mode: 'timestamp'}).notNull(), // Account creation time
  updatedAt: integer('updated_at', {mode: 'timestamp'}).notNull(), // Last update time
});

// Organization Table - 组织/团队信息表
export const organization = sqliteTable("organization", {
  id: text('id').primaryKey(),                          // Organization unique identifier
  name: text('name').notNull(),                         // Organization display name
  slug: text('slug').unique(),                          // URL-friendly identifier
  logo: text('logo'),                                   // Organization logo URL
  createdAt: integer('created_at', {mode: 'timestamp'}).notNull(), // Creation timestamp
  metadata: text('metadata')                            // Additional organization data (JSON)
});

// Subscription Table - Stripe 订阅数据表
export const subscription = sqliteTable("subscription", {
  id: text('id').primaryKey(),                          // Subscription unique identifier
  plan: text('plan').notNull(),                         // Plan name (e.g., "quickxbuild pro")
  referenceId: text('reference_id').notNull(),          // Organization ID reference
  stripeCustomerId: text('stripe_customer_id'),         // Stripe customer ID
  stripeSubscriptionId: text('stripe_subscription_id'), // Stripe subscription ID
  status: text('status').default("incomplete"),         // Subscription status: active, canceled, etc.
  periodStart: integer('period_start', {mode: 'timestamp'}), // Billing period start
  periodEnd: integer('period_end', {mode: 'timestamp'}),     // Billing period end
  cancelAtPeriodEnd: integer('cancel_at_period_end', {mode: 'boolean'}), // Cancel at period end flag
  seats: integer('seats')                               // Number of seats in subscription
});
```

### 项目数据库 (PostgreSQL)

> 📝 **说明**: 项目数据库使用 PostgreSQL，存储配额限制、项目数据和使用统计

```typescript
// packages/db/schema/project-schema.ts

// Subscription Limit Table - 订阅配额限制表（配额管理核心）
export const subscriptionLimit = pgTable('subscription_limit', {
  id: text('id').primaryKey(),                        // Unique identifier
  organizationId: text('organization_id').notNull(),  // Organization reference
  stripeCustomerId: text('stripe_customer_id'),       // Stripe customer ID
  planName: text('plan_name').notNull(),              // Plan name (e.g., "quickxbuild pro")
  planId: text('plan_id').notNull(),                  // Plan identifier

  // Quota Fields - 配额字段
  aiNums: integer('ai_nums').notNull(),               // AI message quota remaining
  enhanceNums: integer('enhance_nums').notNull(),     // Enhancement feature quota
  uploadLimit: integer('upload_limit').notNull(),     // File upload limit
  seats: integer('seats').notNull().default(1),       // Number of seats
  projectNums: integer('project_nums').notNull().default(1), // Project count limit

  // Status Management - 状态管理
  isActive: boolean('is_active').notNull().default(true),    // Active status
  periodStart: timestamp('period_start').notNull(),          // Billing period start
  periodEnd: timestamp('period_end').notNull(),              // Billing period end

  // Timestamps - 时间戳
  createdAt: timestamp('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  // Unique Constraint - 唯一约束：每个组织只能有一个活跃的同名计划
  uniqueOrgPlanActive: uniqueIndex('subscription_limit_org_plan_active_idx')
    .on(table.organizationId, table.planName)
    .where(sql`${table.isActive} = true`)
}))
```

## 认证系统配置

### Better-auth 服务器配置

> 📝 **说明**: Better-auth 是认证系统的核心，集成了 Cloudflare 和 Stripe 插件

```typescript
// packages/auth/auth-server.ts

import { withCloudflare } from '@quickxbuild/better-auth-cloudflare'
import { stripe } from '@quickxbuild/better-auth-stripe'
import { betterAuth } from 'better-auth'
import { admin, bearer, emailOTP, organization } from 'better-auth/plugins'

/**
 * Authentication Builder - 认证系统构建器
 * 配置 Better-auth 实例，集成 Cloudflare 和 Stripe 功能
 */
async function authBuilder() {
  const dbInstance = await getAuthDb()
  const { env } = await getCloudflareContext({ async: true })

  return betterAuth(
    withCloudflare(
      {
        autoDetectIpAddress: true,        // Auto-detect user IP for security
        geolocationTracking: true,        // Enable geolocation tracking
        d1: { db: dbInstance },          // Cloudflare D1 database instance
        kv: env.KV,                      // Cloudflare KV storage for sessions
      },
      {
        // Database Hooks - 数据库钩子：自动分配组织
        databaseHooks: {
          session: {
            create: {
              before: async (session: Session) => {
                // Auto-assign active organization to new sessions
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

        // OAuth Providers - OAuth 提供商配置
        socialProviders: {
          github: {
            clientId: envs.BETTER_GITHUB_CLIENT_ID,
            clientSecret: envs.BETTER_GITHUB_CLIENT_SECRET,
          },
        },

        // Plugin Configuration - 插件配置
        plugins: [
          // Admin Plugin - 管理员插件
          admin({
            defaultRole: 'user',
            adminRoles: ['admin', 'superadmin'],
            adminUserIds: getAdminUserIds(),
          }),
          // Organization Plugin - 组织管理插件
          organization(),
          // Email OTP Plugin - 邮箱验证插件
          emailOTP(),
          // Stripe Plugin - Stripe 支付集成插件
          stripe({
            stripeClient,
            stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET,
            createCustomerOnSignUp: true,
            subscription: {
              enabled: true,
              getCheckoutSessionParams,
              plans: getPlans,
              authorizeReference,
              onSubscriptionComplete,
              onSubscriptionUpdate,
              onSubscriptionCancel,
              onSubscriptionDeleted,
            },
            onEvent,
            onCustomerCreate,
          }),
          // Email Harmony Plugin - 邮件和谐插件
          emailHarmony(),
          // Bearer Token Plugin - Bearer 令牌插件
          bearer(),
        ],
      }
    )
  )
}
```

### 计划类型定义

> 📝 **说明**: 定义订阅计划类型和配额限制，支持 FREE、PRO、MAX 三种计划

```typescript
// packages/auth/utils/subscription-limits/types.ts

// Plan Types - 计划类型常量定义
export const PLAN_TYPES = {
  FREE: 'quickxbuild free',    // Free plan for basic usage
  PRO: 'quickxbuild pro',      // Professional plan for teams
  MAX: 'quickxbuild max'       // Maximum plan for enterprises
} as const

// Plan Type Union - 计划类型联合类型
export type PlanType = typeof PLAN_TYPES[keyof typeof PLAN_TYPES]

// Plan Limits Interface - 计划限制接口定义
export interface PlanLimits {
  aiNums: number          // AI message quota limit
  seats: number           // Number of team seats
  projectNums: number     // Maximum project count
  uploadLimit?: number    // File upload size limit (optional)
}

// Plan Configuration - 计划配置映射表
export const PLAN_CONFIGS: Record<PlanType, PlanLimits> = {
  // Free Plan - 免费计划（适合个人用户）
  [PLAN_TYPES.FREE]: {
    aiNums: 50,           // 50 AI messages per month
    seats: 1,             // Single user
    projectNums: 1,       // 1 project limit
  },
  // Pro Plan - 专业计划（适合小团队）
  [PLAN_TYPES.PRO]: {
    aiNums: 1000,         // 1000 AI messages per month
    seats: 5,             // Up to 5 team members
    projectNums: 10,      // 10 projects limit
  },
  // Max Plan - 最高计划（适合大型团队）
  [PLAN_TYPES.MAX]: {
    aiNums: 5000,         // 5000 AI messages per month
    seats: 20,            // Up to 20 team members
    projectNums: 50,      // 50 projects limit
  },
}
```

## Stripe 集成实现

### 自定义 Stripe 插件

> 📝 **说明**: 自定义 Stripe 插件提供订阅管理、支付处理和 Webhook 事件处理功能

```typescript
// packages/better-auth-stripe/src/index.ts

/**
 * Stripe Plugin - Stripe 支付集成插件
 * 提供订阅升级、取消和 Webhook 处理功能
 */
export const stripe = <O extends StripeOptions>(options: O) => {
  const client = options.stripeClient

  return {
    id: 'stripe',
    endpoints: {
      // Subscription Upgrade Endpoint - 订阅升级端点
      upgradeSubscription: createAuthEndpoint(
        '/subscription/upgrade',
        {
          method: 'POST',
          body: z.object({
            priceId: z.string().optional(),        // Stripe price ID
            lookupKey: z.string().optional(),      // Price lookup key
            referenceId: z.string().optional(),    // Organization reference ID
            successURL: z.string().optional(),     // Success redirect URL
            cancelURL: z.string().optional(),      // Cancel redirect URL
          }),
        },
        async (ctx) => {
          const session = await getSessionFromCtx(ctx)
          const { priceId, lookupKey, referenceId, successURL, cancelURL } = ctx.body

          // Create or get Stripe customer - 创建或获取 Stripe 客户
          const customer = await getOrCreateCustomer(client, session.user)

          // Resolve price ID from lookup key - 解析价格 ID
          const resolvedPriceId = priceId || await resolvePriceIdFromLookupKey(client, lookupKey)

          // Create Stripe Checkout Session - 创建 Stripe 结账会话
          const checkoutSession = await client.checkout.sessions.create({
            customer: customer.id,
            mode: 'subscription',
            line_items: [{ price: resolvedPriceId, quantity: 1 }],
            success_url: successURL || `${ctx.context.options.baseURL}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: cancelURL || `${ctx.context.options.baseURL}/pricing`,
            metadata: {
              referenceId: referenceId || session.user.id,
            },
          })

          return { checkoutURL: checkoutSession.url }
        }
      ),

      // Cancel Subscription Endpoint - 取消订阅端点
      cancelSubscription: createAuthEndpoint(
        '/subscription/cancel',
        {
          method: 'POST',
          body: z.object({
            subscriptionId: z.string(),           // Stripe subscription ID
            referenceId: z.string().optional(),   // Organization reference ID
          }),
        },
        async (ctx) => {
          const { subscriptionId } = ctx.body

          // Create billing portal session for cancellation - 创建计费门户会话进行取消
          const portalSession = await client.billingPortal.sessions.create({
            customer: session.user.stripeCustomerId,
            return_url: `${ctx.context.options.baseURL}/dashboard`,
          })

          return { portalURL: portalSession.url }
        }
      ),

      // Stripe Webhook Handler - Stripe Webhook 处理端点
      stripeWebhook: createAuthEndpoint(
        '/stripe/webhook',
        {
          method: 'POST',
          headers: z.object({
            'stripe-signature': z.string(),       // Stripe webhook signature
          }),
          body: z.any(),                         // Raw webhook payload
        },
        async (ctx) => {
          const sig = ctx.headers['stripe-signature']

          // Verify and construct webhook event - 验证并构造 Webhook 事件
          const event = client.webhooks.constructEvent(
            ctx.body,
            sig,
            options.stripeWebhookSecret
          )

          // Handle different webhook event types - 处理不同类型的 Webhook 事件
          switch (event.type) {
            case 'checkout.session.completed':
              await onCheckoutSessionCompleted(event.data.object, options)
              break
            case 'customer.subscription.updated':
              await onSubscriptionUpdated(event.data.object, options)
              break
            case 'customer.subscription.deleted':
              await onSubscriptionDeleted(event.data.object, options)
              break
          }

          return { received: true }
        }
      ),
    },
  } satisfies BetterAuthPlugin
}
```

### Stripe 事件处理器

> 📝 **说明**: Stripe 事件处理器负责处理订阅生命周期事件，同步订阅状态到本地数据库

```typescript
// packages/auth/plugins/stripe/subscription-handlers.ts

/**
 * Subscription Complete Handler - 订阅完成处理器
 * 当用户成功完成订阅支付时触发
 */
export async function onSubscriptionComplete(subscription: any, user: any) {
  log.subscription('info', 'Processing subscription completion', {
    userId: user.id,
    subscriptionId: subscription.id,
    operation: 'subscription_complete'
  });

  // Extract plan information from subscription - 从订阅中提取计划信息
  const plan = subscription.items.data[0]?.price?.lookup_key || subscription.items.data[0]?.price?.id

  // Create subscription limit record - 创建订阅限制记录
  await createOrUpdateSubscriptionLimit(
    user.activeOrganizationId,
    subscription.customer,
    plan,
    new Date(subscription.current_period_start * 1000),
    new Date(subscription.current_period_end * 1000)
  )
}

/**
 * Subscription Update Handler - 订阅更新处理器
 * 当订阅状态发生变化时触发（如续费、升级等）
 */
export async function onSubscriptionUpdate(subscription: any) {
  log.subscription('info', 'Processing subscription update', {
    subscriptionId: subscription.id,
    status: subscription.status,
    operation: 'subscription_update'
  });

  // Only process active subscriptions - 仅处理活跃订阅
  if (subscription.status === 'active') {
    // Update subscription limits - 更新订阅限制
    const plan = subscription.items.data[0]?.price?.lookup_key
    await createOrUpdateSubscriptionLimit(
      subscription.metadata.referenceId,
      subscription.customer,
      plan,
      new Date(subscription.current_period_start * 1000),
      new Date(subscription.current_period_end * 1000)
    )
  }
}

/**
 * Subscription Cancel Handler - 订阅取消处理器
 * 当用户取消订阅时触发
 */
export async function onSubscriptionCancel(subscription: any) {
  log.subscription('info', 'Processing subscription cancellation', {
    subscriptionId: subscription.id,
    operation: 'subscription_cancel'
  });

  // Cancel paid subscription limits, keep FREE plan - 取消付费订阅限制，保留 FREE 计划
  await cancelSubscriptionLimits(subscription.metadata.referenceId)
}
```

## 配额管理系统

> 📝 **说明**: 配额管理系统是 QuickXBuild 的核心功能，实现了高性能的配额扣减和自动刷新机制

### 核心配额扣减函数

```typescript
// packages/auth/utils/subscription-limits/core.ts

/**
 * AI Message Usage Check and Update - AI 消息配额扣减主函数
 *
 * 使用混合策略 (Hybrid Strategy)：
 * 1. 快速路径 (Fast Path): 付费计划原子操作扣减
 * 2. 慢速路径 (Slow Path): FREE 计划事务处理（支持自动刷新）
 *
 * @param organizationId - Organization unique identifier
 * @returns Promise<boolean> - true if quota available and deducted, false otherwise
 */
export async function checkAndUpdateAIMessageUsage(organizationId: string): Promise<boolean> {
  const db = await getDbAsync()

  // Get database time for UTC consistency - 获取数据库时间确保 UTC 一致性
  const { rows } = await db.execute(sql`SELECT NOW() as "dbNow"`)
  const [{ dbNow }] = rows as [{ dbNow: Date }]
  const now = dbNow

  // Fast Path: Attempt atomic deduction from paid plans - 快速路径：尝试从付费计划原子扣减
  const paidDeductionResult = await attemptPaidPlanDeduction(db, organizationId, now)
  if (paidDeductionResult.success) {
    log.subscription('info', 'AI message deducted from paid plan', {
      organizationId,
      planName: paidDeductionResult.planName,
      remaining: paidDeductionResult.remaining,
    });
    return true
  }

  // Slow Path: Handle FREE plan with transaction safety - 慢速路径：处理 FREE 计划（事务确保数据一致性）
  return await handleFreePlanDeduction(db, organizationId, now)
}

/**
 * Paid Plan Atomic Deduction - 付费计划原子扣减
 *
 * 使用单个 UPDATE 语句实现原子操作，避免竞态条件
 * 只有在配额充足且订阅有效时才会扣减
 *
 * @param db - Database instance
 * @param organizationId - Organization ID
 * @param now - Current timestamp
 * @returns Deduction result with success status and remaining quota
 */
async function attemptPaidPlanDeduction(
  db: any,
  organizationId: string,
  now: Date
): Promise<{ success: boolean; planName?: string; remaining?: number }> {
  const [result, error] = await tryCatch(async () => {
    // Atomic UPDATE with conditions - 带条件的原子更新操作
    const paidUpdated = await db
      .update(subscriptionLimit)
      .set({
        aiNums: sql<number>`(${subscriptionLimit.aiNums}) - 1`,  // Decrement quota by 1
        updatedAt: sql`CURRENT_TIMESTAMP`,                       // Update timestamp
      })
      .where(
        and(
          eq(subscriptionLimit.organizationId, organizationId),              // Match organization
          sql`${subscriptionLimit.planName} != ${PLAN_TYPES.FREE}`,         // Exclude FREE plans
          eq(subscriptionLimit.isActive, true),                             // Only active subscriptions
          sql`(${subscriptionLimit.aiNums}) > 0`,                          // Quota must be available
          sql`${subscriptionLimit.periodEnd} >= ${new Date(now).toISOString()}` // Subscription not expired
        )
      )
      .returning({
        remaining: subscriptionLimit.aiNums,    // Return remaining quota
        planName: subscriptionLimit.planName,   // Return plan name
      })

    // Check if deduction was successful - 检查扣减是否成功
    if (paidUpdated.length > 0) {
      const result = paidUpdated[0]
      return {
        success: true,
        planName: result?.planName || 'unknown',
        remaining: result?.remaining || 0,
      }
    }

    return { success: false }
  })

  return result || { success: false }
}

/**
 * FREE 计划事务处理
 */
async function handleFreePlanDeduction(
  db: any,
  organizationId: string,
  now: Date
): Promise<boolean> {
  return await db.transaction(async (tx: any) => {
    // 锁定 FREE 计划记录防止竞态条件
    const freeLimit = await tx
      .select()
      .from(subscriptionLimit)
      .where(
        and(
          eq(subscriptionLimit.organizationId, organizationId),
          eq(subscriptionLimit.planName, PLAN_TYPES.FREE),
          eq(subscriptionLimit.isActive, true)
        )
      )
      .for('update')
      .limit(1)
      .then((rows: any[]) => rows[0])

    if (!freeLimit) {
      return false
    }

    // 检查是否需要刷新配额（周期过期）
    const periodEndDate = new Date(freeLimit.periodEnd)
    const nowTimestamp = new Date(now).getTime()
    const periodEndTimestamp = periodEndDate.getTime()

    if (nowTimestamp > periodEndTimestamp) {
      // 配额过期，刷新并立即扣减
      const { limits: freePlanLimits } = await getPlanLimits(PLAN_TYPES.FREE)
      
      let newPeriodStart = new Date(freeLimit.periodStart)
      while (addMonths(newPeriodStart, 1).getTime() <= nowTimestamp) {
        newPeriodStart = addMonths(newPeriodStart, 1)
      }

      await tx
        .update(subscriptionLimit)
        .set({
          aiNums: freePlanLimits.aiNums - 1, // 刷新并扣减
          enhanceNums: freePlanLimits.aiNums,
          seats: freePlanLimits.seats,
          projectNums: freePlanLimits.projectNums,
          periodStart: newPeriodStart.toISOString(),
          periodEnd: addMonths(newPeriodStart, 1).toISOString(),
          updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(subscriptionLimit.id, freeLimit.id))

      return true
    }

    // 检查当前配额
    if (freeLimit.aiNums <= 0) {
      return false
    }

    // 原子扣减
    const freeUpdated = await tx
      .update(subscriptionLimit)
      .set({
        aiNums: sql<number>`(${subscriptionLimit.aiNums}) - 1`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(
        and(
          eq(subscriptionLimit.id, freeLimit.id),
          eq(subscriptionLimit.isActive, true),
          sql`(${subscriptionLimit.aiNums}) > 0`
        )
      )
      .returning({ remaining: subscriptionLimit.aiNums })

    return freeUpdated.length > 0
  })
}
```

### 项目配额管理

```typescript
/**
 * 获取组合项目配额（FREE + PAID）
 */
export async function getCombinedProjectQuota(organizationId: string) {
  const usage = await getSubscriptionUsage(organizationId)
  const freeDetails = usage.planDetails.free
  const paidDetails = usage.planDetails.paid

  // 计算组合配额
  const combinedProjectNums = (freeDetails?.projectNums || 0) + (paidDetails?.projectNums || 0)
  const combinedProjectNumsLimit = 
    (freeDetails?.projectNumsLimit || 0) + (paidDetails?.projectNumsLimit || 0)

  return {
    projectNums: combinedProjectNums,
    projectNumsLimit: combinedProjectNumsLimit,
    plan: paidDetails?.plan || freeDetails?.plan || PLAN_TYPES.FREE,
    planDetails: { free: freeDetails, paid: paidDetails },
  }
}

/**
 * 项目删除时恢复配额
 * 优先恢复到 FREE 计划以优化配额利用
 */
export async function restoreProjectQuotaOnDeletion(organizationId: string) {
  const db = await getDbAsync()
  
  return await db.transaction(async (tx: any) => {
    // 步骤1：尝试恢复到 FREE 计划
    const freeLimits = await tx
      .select()
      .from(subscriptionLimit)
      .where(
        and(
          eq(subscriptionLimit.organizationId, organizationId),
          eq(subscriptionLimit.planName, PLAN_TYPES.FREE),
          eq(subscriptionLimit.isActive, true)
        )
      )
      .for('update')
      .limit(1)
      .then((rows: any[]) => rows[0])

    if (freeLimits) {
      const { limits: freePlanLimits } = await getPlanLimits(PLAN_TYPES.FREE)
      const newFreeProjectNums = freeLimits.projectNums + 1

      if (newFreeProjectNums <= freePlanLimits.projectNums) {
        const freeUpdated = await tx
          .update(subscriptionLimit)
          .set({
            projectNums: sql<number>`(${subscriptionLimit.projectNums}) + 1`,
          })
          .where(
            and(
              eq(subscriptionLimit.id, freeLimits.id),
              eq(subscriptionLimit.isActive, true),
              sql`(${subscriptionLimit.projectNums}) < ${freePlanLimits.projectNums}`
            )
          )
          .returning({ projectNums: subscriptionLimit.projectNums })

        if (freeUpdated.length > 0) {
          return { success: true, restoredTo: 'FREE', planName: PLAN_TYPES.FREE }
        }
      }
    }

    // 步骤2：回退到付费计划恢复
    const paidLimits = await tx
      .select()
      .from(subscriptionLimit)
      .where(
        and(
          eq(subscriptionLimit.organizationId, organizationId),
          sql`${subscriptionLimit.planName} != ${PLAN_TYPES.FREE}`,
          eq(subscriptionLimit.isActive, true)
        )
      )
      .for('update')
      .limit(1)
      .then((rows: any[]) => rows[0])

    if (paidLimits) {
      const { limits: planLimits } = await getPlanLimits(paidLimits.planName)
      const newProjectNums = paidLimits.projectNums + 1

      if (newProjectNums <= planLimits.projectNums) {
        const paidUpdated = await tx
          .update(subscriptionLimit)
          .set({
            projectNums: sql<number>`(${subscriptionLimit.projectNums}) + 1`,
          })
          .where(
            and(
              eq(subscriptionLimit.id, paidLimits.id),
              eq(subscriptionLimit.isActive, true),
              sql`(${subscriptionLimit.projectNums}) < ${planLimits.projectNums}`
            )
          )
          .returning({
            projectNums: subscriptionLimit.projectNums,
            planName: subscriptionLimit.planName,
          })

        if (paidUpdated.length > 0) {
          const result = paidUpdated[0]
          return {
            success: true,
            restoredTo: 'PAID',
            planName: result?.planName,
          }
        }
      }
    }

    return { success: false, error: 'No active plans found for restoration' }
  })
}
```

## API 路由详解

### Stripe 相关路由

```typescript
// packages/api/src/router/stripe.ts

export const stripeRouter = {
  // 获取用户计划信息
  getUserPlans: publicProcedure.query(async ({ ctx }) => {
    const auth = await initAuth()
    const sessionData = await auth.api.getSession({ headers: await headers() })
    const user = sessionData?.user

    if (user) {
      const activeOrg = await getActiveOrganization(user.id)
      
      // 获取当前订阅限制
      const currentLimits = await projectDb
        .select({ planName: subscriptionLimit.planName })
        .from(subscriptionLimit)
        .where(
          and(
            eq(subscriptionLimit.organizationId, activeOrg.id),
            eq(subscriptionLimit.isActive, true)
          )
        )

      // 获取活跃订阅
      const activeSubscriptions = await db
        .select({ plan: subscription.plan })
        .from(subscription)
        .where(
          and(
            eq(subscription.referenceId, activeOrg.id),
            eq(subscription.status, 'active')
          )
        )

      // 合并所有计划
      const allPlans = new Set<string>()
      currentLimits.forEach(limit => allPlans.add(limit.planName))
      activeSubscriptions.forEach(sub => allPlans.add(sub.plan))
      
      if (allPlans.size === 0) allPlans.add('FREE')

      const currentUserPlans = Array.from(allPlans)
      
      // 确定主要计划（付费计划优先）
      const paidPlans = currentUserPlans.filter(plan => !plan.toLowerCase().includes('free'))
      const primaryPlan = paidPlans.find(plan => plan.toLowerCase().includes('pro')) ||
                         paidPlans.find(plan => plan.toLowerCase().includes('max')) ||
                         paidPlans[0] ||
                         'FREE'

      return {
        code: 'SUCCESS',
        data: mapToPlans(planPrices, primaryPlan),
        currentUserPlan: primaryPlan,
        currentUserPlans,
        hasPaidSubscription: paidPlans.length > 0,
      }
    }

    return { code: 'SUCCESS', data: [], currentUserPlan: 'FREE' }
  }),

  // 检查是否为付费用户
  isPaid: organizationProcedure.query(async (opts) => {
    const { db } = opts.ctx
    const { orgId } = opts.input

    const activeSubscription = await db
      .select()
      .from(subscription)
      .where(
        and(
          eq(subscription.referenceId, orgId),
          eq(subscription.status, 'active')
        )
      )
      .then(rows => rows[0])

    return {
      code: 'SUCCESS',
      data: {
        isPaid: !!activeSubscription,
        subscription: activeSubscription || null,
      },
    }
  }),

  // 创建计费门户会话
  createPortalSession: organizationProcedure.mutation(async (opts) => {
    const { session, db } = opts.ctx
    const userId = session.user.id

    const [userData] = await db.select().from(user).where(eq(user.id, userId))

    if (!userData?.stripeCustomerId) {
      throw new Error('User does not have a valid payment customer ID')
    }

    const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-05-28.basil',
    })

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: userData.stripeCustomerId,
      return_url: getURL('dashboard'),
    })

    return {
      code: 'SUCCESS',
      data: { url: portalSession.url },
    }
  }),

  // 获取订阅使用情况
  getSubscriptionUsage: organizationProcedure.query(async (opts) => {
    const { db } = opts.ctx
    const { orgId } = opts.input

    if (!orgId) {
      return { code: 'SUCCESS', data: DEFAULT_FREE_LIMITS }
    }

    const [limit] = await db
      .select()
      .from(subscriptionLimit)
      .where(
        and(
          eq(subscriptionLimit.organizationId, orgId),
          eq(subscriptionLimit.isActive, true)
        )
      )

    if (!limit) {
      return { code: 'SUCCESS', data: DEFAULT_FREE_LIMITS }
    }

    return {
      code: 'SUCCESS',
      data: {
        aiNums: limit.aiNums,
        aiNumsLimit: limit.aiNums,
        seats: limit.seats,
        seatsLimit: limit.seats,
        projectNums: limit.projectNums,
        projectNumsLimit: limit.projectNums,
        plan: limit.planName,
        isActive: limit.isActive,
        periodEnd: limit.periodEnd,
      },
    }
  }),
}
```

### 使用示例

```typescript
// 前端使用示例
import { api } from '@/utils/trpc'

function SubscriptionDashboard() {
  // 获取用户计划
  const { data: userPlans } = api.stripe.getUserPlans.useQuery()
  
  // 获取使用情况
  const { data: usage } = api.stripe.getSubscriptionUsage.useQuery({
    orgId: currentOrgId
  })
  
  // 检查是否为付费用户
  const { data: paidStatus } = api.stripe.isPaid.useQuery({
    orgId: currentOrgId
  })

  // 创建计费门户会话
  const createPortal = api.stripe.createPortalSession.useMutation({
    onSuccess: (result) => {
      window.open(result.data.url, '_blank')
    }
  })

  return (
    <div className="subscription-dashboard">
      <h2>当前计划: {userPlans?.currentUserPlan}</h2>
      <div className="usage-stats">
        <p>AI 消息: {usage?.data.aiNums} / {usage?.data.aiNumsLimit}</p>
        <p>项目数: {usage?.data.projectNums} / {usage?.data.projectNumsLimit}</p>
        <p>座位数: {usage?.data.seats} / {usage?.data.seatsLimit}</p>
      </div>
      
      {paidStatus?.data.isPaid && (
        <button onClick={() => createPortal.mutate()}>
          管理订阅
        </button>
      )}
    </div>
  )
}
```

## 错误处理模式

### 配额不足处理

```typescript
// 在需要使用 AI 功能的地方
async function generateAIResponse(organizationId: string, prompt: string) {
  // 检查并扣减配额
  const hasQuota = await checkAndUpdateAIMessageUsage(organizationId)
  
  if (!hasQuota) {
    throw new APIError('QUOTA_EXCEEDED', {
      message: 'AI message quota exhausted',
      code: 'QUOTA_EXCEEDED',
      details: {
        quotaType: 'ai_messages',
        organizationId,
        suggestedAction: 'upgrade_plan'
      }
    })
  }

  try {
    // 执行 AI 请求
    const response = await callAIService(prompt)
    return response
  } catch (error) {
    // AI 请求失败，恢复配额
    await restoreAIQuotaOnError(organizationId)
    throw error
  }
}

// 错误恢复函数
async function restoreAIQuotaOnError(organizationId: string) {
  const db = await getDbAsync()
  
  // 尝试恢复扣减的配额
  await db
    .update(subscriptionLimit)
    .set({
      aiNums: sql<number>`(${subscriptionLimit.aiNums}) + 1`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(
      and(
        eq(subscriptionLimit.organizationId, organizationId),
        eq(subscriptionLimit.isActive, true)
      )
    )
}
```

### Stripe Webhook 错误处理

```typescript
// packages/auth/plugins/stripe/webhook-handlers.ts

export async function handleStripeWebhook(event: Stripe.Event) {
  const [result, error] = await tryCatch(async () => {
    switch (event.type) {
      case 'checkout.session.completed':
        await onCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session)
        break
        
      case 'customer.subscription.updated':
        await onSubscriptionUpdated(event.data.object as Stripe.Subscription)
        break
        
      case 'customer.subscription.deleted':
        await onSubscriptionDeleted(event.data.object as Stripe.Subscription)
        break
        
      case 'invoice.payment_failed':
        await onPaymentFailed(event.data.object as Stripe.Invoice)
        break
        
      default:
        log.subscription('warn', `Unhandled webhook event type: ${event.type}`)
    }
  })

  if (error) {
    log.subscription('error', 'Webhook processing failed', {
      eventType: event.type,
      eventId: event.id,
    }, error as Error)
    
    // 对于关键事件，可以实现重试机制
    if (['checkout.session.completed', 'customer.subscription.updated'].includes(event.type)) {
      await scheduleWebhookRetry(event)
    }
    
    throw error
  }

  return result
}

async function onPaymentFailed(invoice: Stripe.Invoice) {
  const customerId = invoice.customer as string
  const subscriptionId = invoice.subscription as string

  log.subscription('warn', 'Payment failed', {
    customerId,
    subscriptionId,
    operation: 'payment_failed'
  })

  // 可以发送邮件通知用户支付失败
  // 或者标记账户状态等
}
```

### 前端错误处理

```typescript
// 前端错误处理示例
import { toast } from '@/components/ui/use-toast'

function handleQuotaError(error: any) {
  if (error?.code === 'QUOTA_EXCEEDED') {
    const quotaType = error.details?.quotaType
    
    switch (quotaType) {
      case 'ai_messages':
        toast({
          title: "AI 消息配额已用完",
          description: "请升级到付费计划以获得更多配额",
          action: (
            <Button onClick={() => router.push('/pricing')}>
              查看计划
            </Button>
          ),
        })
        break
        
      case 'projects':
        toast({
          title: "项目数量已达上限",
          description: "请删除不需要的项目或升级计划",
          variant: "destructive",
        })
        break
        
      default:
        toast({
          title: "配额不足",
          description: "请检查你的订阅状态",
          variant: "destructive",
        })
    }
  }
}

// 在组件中使用
const generateContent = api.ai.generate.useMutation({
  onError: handleQuotaError,
  onSuccess: (data) => {
    // 处理成功响应
  }
})
```

## 测试与开发

### 本地开发环境

```bash
# 1. 设置环境变量
cp .env.example .env.local
# 编辑 .env.local 文件，填入必要的配置

# 2. 启动本地数据库
docker run -d \
  --name quickxbuild-postgres \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=quickxbuild \
  -p 5432:5432 \
  postgres:15

# 3. 运行迁移
bun migration:local

# 4. 启动开发服务器
bun dev

# 5. 在另一个终端启动 Stripe CLI 监听 webhook
stripe listen --forward-to localhost:3000/api/auth/stripe/webhook
```

### 测试 Stripe 集成

```typescript
// tests/stripe-integration.test.ts

import { describe, it, expect, beforeEach } from 'bun:test'
import { createMockStripeWebhook, createTestUser } from './test-utils'

describe('Stripe Integration', () => {
  beforeEach(async () => {
    // 清理测试数据
    await cleanupTestData()
  })

  it('should create subscription limits on checkout completion', async () => {
    // 创建测试用户和组织
    const { user, organization } = await createTestUser()

    // 模拟 Stripe checkout.session.completed 事件
    const checkoutEvent = createMockStripeWebhook('checkout.session.completed', {
      customer: user.stripeCustomerId,
      subscription: 'sub_test123',
      metadata: {
        referenceId: organization.id,
      },
    })

    // 处理 webhook
    await handleStripeWebhook(checkoutEvent)

    // 验证订阅限制是否创建
    const limits = await getSubscriptionUsage(organization.id)
    expect(limits.plan).not.toBe('quickxbuild free')
    expect(limits.aiNums).toBeGreaterThan(50) // 付费计划配额更高
  })

  it('should handle quota deduction correctly', async () => {
    const { organization } = await createTestUser()
    
    // 创建付费订阅限制
    await createOrUpdateSubscriptionLimit(
      organization.id,
      'cus_test123',
      'quickxbuild pro',
      new Date(),
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30天后
      { aiNums: 100, seats: 5, projectNums: 10 }
    )

    // 测试配额扣减
    const success = await checkAndUpdateAIMessageUsage(organization.id)
    expect(success).toBe(true)

    // 验证配额减少
    const usage = await getSubscriptionUsage(organization.id)
    expect(usage.aiNums).toBe(99)
  })

  it('should handle FREE plan quota refresh', async () => {
    const { organization } = await createTestUser()
    
    // 创建过期的 FREE 计划
    const pastDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000) // 35天前
    await createOrUpdateSubscriptionLimit(
      organization.id,
      null,
      'quickxbuild free',
      pastDate,
      new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5天前过期
      { aiNums: 0, seats: 1, projectNums: 1 }
    )

    // 尝试使用配额（应该触发刷新）
    const success = await checkAndUpdateAIMessageUsage(organization.id)
    expect(success).toBe(true)

    // 验证配额已刷新
    const usage = await getSubscriptionUsage(organization.id)
    expect(usage.aiNums).toBe(49) // 刷新到50，扣减1
  })
})
```

### 调试技巧

```typescript
// 开启详细日志
process.env.DEBUG = 'stripe:*,auth:*,subscription:*'

// 使用日志查看配额状态
import { log } from '@quickxbuild/common'

export async function debugQuotaStatus(organizationId: string) {
  const usage = await getSubscriptionUsage(organizationId)
  
  log.subscription('debug', 'Quota status debug', {
    organizationId,
    usage,
    operation: 'debug_quota_status'
  })

  return usage
}

// 在开发环境中添加调试端点
if (process.env.NODE_ENV === 'development') {
  app.get('/debug/quota/:orgId', async (req, res) => {
    const usage = await debugQuotaStatus(req.params.orgId)
    res.json(usage)
  })
}
```

### 性能监控

```typescript
// 配额操作性能监控
import { performance } from 'perf_hooks'

export async function checkAndUpdateAIMessageUsageWithTiming(organizationId: string) {
  const start = performance.now()
  
  try {
    const result = await checkAndUpdateAIMessageUsage(organizationId)
    const duration = performance.now() - start
    
    log.subscription('info', 'Quota deduction timing', {
      organizationId,
      duration: `${duration.toFixed(2)}ms`,
      result,
      operation: 'quota_deduction_timing'
    })
    
    // 如果操作耗时过长，记录警告
    if (duration > 1000) {
      log.subscription('warn', 'Slow quota deduction detected', {
        organizationId,
        duration: `${duration.toFixed(2)}ms`,
        operation: 'slow_quota_deduction'
      })
    }
    
    return result
  } catch (error) {
    const duration = performance.now() - start
    log.subscription('error', 'Quota deduction failed', {
      organizationId,
      duration: `${duration.toFixed(2)}ms`,
      operation: 'quota_deduction_error'
    }, error as Error)
    throw error
  }
}
```

## 总结

这套 Better-auth + Stripe 集成方案提供了完整的 SaaS 订阅管理解决方案：

### 🎯 核心优势

1. **强大的订阅管理 (Robust Subscription Management)**: 支持多种计划类型和灵活的配额系统
2. **高性能配额系统 (High-Performance Quota System)**: 原子操作 + 事务处理确保数据一致性
3. **完善的错误处理 (Comprehensive Error Handling)**: 涵盖配额不足、支付失败等各种场景
4. **开发友好 (Developer-Friendly)**: 详细的日志记录和调试工具
5. **生产就绪 (Production-Ready)**: 支持 Cloudflare Workers 部署

### 📚 相关资源

- [Better-auth 官方文档](https://better-auth.com)
- [Stripe 开发者文档](https://stripe.com/docs)
- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [项目 GitHub 仓库](https://github.com/nextify-limited/quickxbuild)

### 🤝 贡献指南

欢迎为本文档贡献改进建议！请参考 [贡献指南](../../CONTRIBUTING.md) 了解详细信息。

---

通过遵循这些模式和最佳实践，您可以构建出稳定可靠的 SaaS 订阅系统。如有问题，请参考相关文档或在 GitHub 上提交 Issue。
