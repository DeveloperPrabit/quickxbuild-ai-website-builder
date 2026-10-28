# QuickXBuild DB 包

QuickXBuild DB 是一个专注于数据库管理的现代化核心包，为整个应用提供统一、类型安全的业务数据访问层。该包基于 **Drizzle ORM** 构建，实现了完全类型安全的数据库操作，并针对 **Cloudflare** 环境进行了深度优化。它提供智能的环境适应性连接解决方案，能够在开发环境和生产环境之间无缝切换，同时利用 Cloudflare Hyperdrive 技术显著提升 Serverless 场景下的数据库性能。通过集中管理的数据模型定义和 React 缓存机制，确保整个应用使用一致的数据结构，并有效防止资源浪费和连接泄漏。

## 🚀 核心特性

### 🎯 类型安全的数据库操作
- **Drizzle ORM 集成**：完全类型安全的数据库查询和操作
- **自动类型推断**：从 schema 自动生成 TypeScript 类型
- **编译时检查**：在编译阶段发现 SQL 错误和类型不匹配
- **IntelliSense 支持**：完整的代码补全和类型提示

### ⚡ 高性能数据库连接
- **Cloudflare Hyperdrive**：生产环境下的数据库连接加速
- **连接池管理**：智能的 PostgreSQL 连接池配置
- **React 缓存优化**：防止重复连接创建，提升性能
- **Serverless 优化**：专为 Serverless 环境设计的连接策略

### 🔄 环境适应性
- **自动环境检测**：智能识别开发和生产环境
- **配置统一**：相同代码在不同环境下自动适配
- **热切换支持**：无需重启即可切换数据库连接
- **环境隔离**：确保开发和生产数据的完全隔离

### 🧩 模块化架构
- **Schema 分离**：按业务领域分离数据模型定义
- **领域驱动**：项目、组件、订阅等独立模块
- **扩展性强**：易于添加新的业务领域和数据模型
- **依赖管理**：清晰的模块间依赖关系

### 🛡️ 企业级功能
- **数据迁移**：完整的数据库版本控制和迁移管理
- **性能监控**：数据库连接和查询性能追踪
- **安全性**：SQL 注入防护和权限控制
- **审计日志**：完整的数据变更追踪记录

## 📁 项目结构

```bash
packages/db/
├── DEV-ZH.md                 # 中文开发文档
├── DEV.md                    # 英文开发文档
├── README.md                 # 包说明文档
├── package.json              # 包依赖与脚本定义
├── tsconfig.json             # TypeScript 配置
├── tsup.config.ts            # 构建配置
├── env.mjs                   # 环境变量配置与验证
├── drizzle.config.ts         # Drizzle ORM 配置
├── index.ts                  # 主要导出文件
├── cloudflare-env.d.ts       # Cloudflare 环境类型定义
├── custom-domain-queries.ts  # 自定义域名查询函数
├── drizzle/                  # Drizzle ORM 元数据
│   ├── 0000_*.sql           # 数据库迁移 SQL 文件
│   └── meta/                 # 迁移元数据和版本信息
│       ├── 0000_snapshot.json # 数据库结构快照
│       └── _journal.json     # 迁移历史记录
├── schema/                   # 数据库模式定义
│   ├── project-schema.ts     # 项目相关表结构定义
│   └── components-schema.ts  # 组件相关表结构定义
└── utils/                    # 工具函数
    └── subscription.ts       # 订阅相关工具函数
```

## 🛠️ 技术实现

### 核心技术栈
- **Drizzle ORM**：现代 TypeScript ORM，提供类型安全的数据库操作
- **PostgreSQL**：企业级关系型数据库
- **Cloudflare Hyperdrive**：数据库连接加速服务
- **React Cache**：服务器端组件缓存机制
- **Node.js pg**：高性能 PostgreSQL 客户端

### 架构设计
- **连接层抽象**：统一的数据库连接接口
- **环境适配**：自动检测和适配不同部署环境
- **缓存策略**：多层次的数据库连接和查询缓存
- **类型系统**：端到端的 TypeScript 类型安全

## 🚀 安装与配置

### 环境变量配置

```bash
# 开发环境配置（.env.local）
POSTGRES_URL=postgresql://username:password@localhost:5432/quickxbuild_dev

# 生产环境配置（Cloudflare）
# HYPERDRIVE 连接将自动通过 Cloudflare 环境提供
```

### 数据库初始化

```bash
# 安装依赖
bun install

# 生成迁移文件
bun db:generate

# 执行数据库迁移
bun db:migrate

# 查看数据库状态
bun db:status
```

## 🔧 核心功能

### 数据库连接管理

```typescript
// 异步数据库连接（用于 Next.js 应用）
import { getDbAsync } from '@quickxbuild/db'

export async function GET() {
  const db = await getDbAsync()
  const projects = await db.select().from(project)
  return Response.json(projects)
}

// Hono 应用数据库连接（用于 Cloudflare Workers）
import { getDbForHono } from '@quickxbuild/db'

export async function handler(c: Context) {
  const db = await getDbForHono(c)
  const projects = await db.select().from(project)
  return c.json(projects)
}

// Workflow 应用数据库连接
import { getDbForWorkflow } from '@quickxbuild/db'

export async function workflowHandler(env: any) {
  const db = await getDbForWorkflow(env)
  const projects = await db.select().from(project)
  return projects
}
```

### 类型安全的查询操作

```typescript
import { getDbAsync, project, projectAIUsage } from '@quickxbuild/db'
import { eq, and, desc } from 'drizzle-orm'

// 查询项目
const db = await getDbAsync()

// 创建新项目
const newProject = await db.insert(project).values({
  name: '我的新项目',
  templateType: 'nextjs',
  userId: 'user_123',
  organizationId: 'org_456',
  visibility: 'private'
}).returning()

// 查询用户项目
const userProjects = await db
  .select()
  .from(project)
  .where(and(
    eq(project.userId, 'user_123'),
    eq(project.isActive, true)
  ))
  .orderBy(desc(project.createdAt))

// 联表查询项目和使用情况
const projectsWithUsage = await db
  .select({
    project: project,
    usage: projectAIUsage
  })
  .from(project)
  .leftJoin(projectAIUsage, eq(project.id, projectAIUsage.projectId))
  .where(eq(project.organizationId, 'org_456'))
```

### 事务操作

```typescript
import { getDbAsync } from '@quickxbuild/db'

const db = await getDbAsync()

// 事务：创建项目并初始化使用记录
await db.transaction(async (tx) => {
  // 创建项目
  const [newProject] = await tx.insert(project).values({
    name: '新项目',
    templateType: 'nextjs',
    userId: 'user_123',
    organizationId: 'org_456'
  }).returning()

  // 初始化 AI 使用记录
  await tx.insert(projectAIUsage).values({
    projectId: newProject.id,
    organizationId: 'org_456',
    totalAIMessageCount: 0
  })
})
```

## 📊 数据模型

### 项目管理模块

#### Project 表
项目的核心信息管理表。

```typescript
export const project = pgTable('project', {
  id: text('id').primaryKey().unique(),          // 项目唯一标识
  name: text('name').notNull(),                  // 项目名称
  templateType: text('template_type').notNull(), // 模板类型
  url: text('url'),                              // 项目访问 URL
  gitUrl: text('git_url'),                       // Git 仓库地址
  gitBranch: text('git_branch'),                 // Git 分支
  previewImageUrl: text('preview_image_url'),    // 预览图片 URL
  productionDeployUrl: text('production_deploy_url'), // 生产部署 URL
  workflowId: text('workflow_id'),               // 工作流 ID
  deploymentStatus: varchar('deployment_status', { // 部署状态
    enum: ['idle', 'preparing', 'deploying', 'deployed', 'failed']
  }).default('idle'),
  customDomain: text('custom_domain'),           // 自定义域名
  customDomainStatus: varchar('custom_domain_status', { // 自定义域名状态
    enum: ['pending', 'verified', 'active', 'failed']
  }),
  customDomainVerifiedAt: timestamp('custom_domain_verified_at'), // 自定义域名验证时间
  customHostnameId: text('custom_hostname_id'),  // 自定义主机名 ID
  ownershipVerification: text('ownership_verification'), // 所有权验证
  sslStatus: varchar('ssl_status', {             // SSL 状态
    enum: ['pending', 'pending_validation', 'active', 'failed']
  }),
  visibility: varchar('visibility', { enum: ['public', 'private'] }), // 可见性
  isActive: boolean('is_active').default(true),  // 是否活跃
  userId: text('user_id').notNull(),             // 用户 ID
  organizationId: text('organization_id').notNull(), // 组织 ID
  containerId: text('container_id'),             // 容器 ID
  initialMessage: text('initial_message'),       // 初始消息
  knowledge: text('knowledge'),                  // 知识库内容
  messageHistory: text('message_history').default('[]'), // 消息历史
  createdAt: timestamp('created_at'),            // 创建时间
  updatedAt: timestamp('updated_at')             // 更新时间
})

// TypeScript 类型
type Project = typeof project.$inferSelect
type InsertProject = typeof project.$inferInsert
```

#### ProjectAIUsage 表
项目 AI 功能使用统计表。

```typescript
export const projectAIUsage = pgTable('project_ai_usage', {
  id: text('id').primaryKey(),                   // 记录唯一标识
  projectId: text('project_id').references(() => project.id), // 项目 ID（外键）
  organizationId: text('organization_id').notNull(), // 组织 ID
  totalAIMessageCount: integer('total_ai_message_count').default(0), // 总 AI 消息数
  lastUsedAt: timestamp('last_used_at'),         // 最后使用时间
  createdAt: timestamp('created_at'),            // 创建时间
  updatedAt: timestamp('updated_at')             // 更新时间
})
```

### 订阅管理模块

#### SubscriptionLimit 表
组织订阅限制和计费信息管理表。

```typescript
export const subscriptionLimit = pgTable('subscription_limit', {
  id: text('id').primaryKey(),                   // 记录唯一标识
  organizationId: text('organization_id').notNull(), // 组织 ID
  stripeCustomerId: text('stripe_customer_id'),  // Stripe 客户 ID
  planName: text('plan_name').notNull(),         // 订阅计划名称
  planId: text('plan_id').notNull(),             // 订阅计划 ID
  aiNums: integer('ai_nums').notNull(),          // AI 使用次数限制
  enhanceNums: integer('enhance_nums').notNull(), // 增强功能次数限制
  uploadLimit: integer('upload_limit').notNull(), // 上传限制
  deployLimit: integer('deploy_limit').notNull(), // 部署限制
  seats: integer('seats').default(1),           // 席位数
  projectNums: integer('project_nums').default(1), // 项目数限制
  isActive: boolean('is_active').default(true), // 是否活跃
  periodStart: timestamp('period_start'),       // 订阅周期开始
  periodEnd: timestamp('period_end'),           // 订阅周期结束
  createdAt: timestamp('created_at'),           // 创建时间
  updatedAt: timestamp('updated_at')            // 更新时间
}, (table) => ({
  // 唯一约束：每个组织只能有一个活跃的计划
  uniqueOrgPlanActive: uniqueIndex('subscription_limit_org_plan_active_idx')
    .on(table.organizationId, table.planName)
    .where(sql`${table.isActive} = true`)
}))
```

### 组件管理模块

#### Components 表
UI 组件库管理表。

```typescript
export const components = pgTable('components', {
  id: integer('id').primaryKey(),                // 组件唯一标识
  name: text('name').notNull(),                  // 组件名称
  component_slug: text('component_slug').unique(), // 组件 slug
  code: text('code'),                            // 组件代码
  compiled_css: text('compiled_css'),            // 编译后的 CSS
  component_names: json('component_names').notNull(), // 组件名称列表
  demo_code: text('demo_code'),                  // 演示代码
  demo_dependencies: json('demo_dependencies'),  // 演示依赖
  demo_direct_registry_dependencies: json('demo_direct_registry_dependencies'), // 演示直接注册依赖
  dependencies: json('dependencies'),            // 依赖列表
  direct_registry_dependencies: json('direct_registry_dependencies'), // 直接注册依赖
  description: text('description'),              // 组件描述
  global_css_extension: text('global_css_extension'), // 全局 CSS 扩展
  tailwind_config_extension: text('tailwind_config_extension'), // Tailwind 配置扩展
  downloads_count: integer('downloads_count').default(0), // 下载次数
  likes_count: integer('likes_count').default(0), // 点赞次数
  is_public: boolean('is_public').default(false), // 是否公开
  is_paid: boolean('is_paid').default(false),   // 是否付费
  payment_url: text('payment_url'),              // 付费 URL
  preview_url: text('preview_url').notNull(),   // 预览 URL
  created_at: timestamp('created_at'),          // 创建时间
  updated_at: timestamp('updated_at')           // 更新时间
})
```

#### ProjectAsset 表
项目资产文件管理表，用于跟踪项目相关的附件文件。

```typescript
export const projectAsset = pgTable('project_asset', {
  id: text('id').primaryKey(),                   // 资产唯一标识
  organizationId: text('organization_id').notNull(), // 组织 ID
  projectId: text('project_id')                  // 项目 ID（外键）
    .notNull()
    .references(() => project.id, { onDelete: 'cascade' }),
  planId: text('plan_id').notNull(),             // 计划 ID
  attachmentKey: text('attachment_key').notNull(), // 附件键
  createdAt: timestamp('created_at'),            // 创建时间
  updatedAt: timestamp('updated_at')             // 更新时间
})
```

### 工具函数模块

#### 自定义域名查询
提供自定义域名相关的数据库查询功能。

```typescript
import { findProjectByCustomDomain, validateCustomDomainProject } from '@quickxbuild/db'

// 根据自定义域名查找项目
const result = await findProjectByCustomDomain(db, 'example.com')
if (result.success && result.project) {
  // 验证域名配置
  const validation = validateCustomDomainProject(result.project)
  if (validation.valid) {
    // 域名配置正确，可以使用
  }
}
```

#### 订阅工具函数
提供订阅相关的业务逻辑函数。

```typescript
import { hasPremiumMembership } from '@quickxbuild/db'

// 检查组织是否有高级会员资格
const isPremium = await hasPremiumMembership('org_123')
if (isPremium) {
  // 允许访问高级功能
}
```

## 🔧 开发指南

### 本地开发环境

```bash
# 启动本地 PostgreSQL 数据库
docker run --name quickxbuild-postgres \
  -e POSTGRES_DB=quickxbuild_dev \
  -e POSTGRES_USER=quickxbuild \
  -e POSTGRES_PASSWORD=password \
  -p 5432:5432 \
  -d postgres:15

# 设置环境变量
export POSTGRES_URL="postgresql://quickxbuild:password@localhost:5432/quickxbuild_dev"

# 运行迁移
bun db:migrate
```

### 添加新的数据表

1. **创建 Schema 文件**

```typescript
// schema/user-schema.ts
import { pgTable, text, timestamp, boolean } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'

export const user = pgTable('user', {
  id: text('id').$defaultFn(() => createId()).primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  avatar: text('avatar'),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date())
})

export type User = typeof user.$inferSelect
export type InsertUser = typeof user.$inferInsert
```

2. **更新主导出文件**

```typescript
// index.ts
import * as userSchema from './schema/user-schema'

export const schema = { 
  ...projectSchema, 
  ...components,
  ...userSchema  // 添加新的 schema
}
```

3. **生成和执行迁移**

```bash
# 生成迁移文件
bun db:generate

# 执行迁移
bun db:migrate
```

### 数据库查询最佳实践

```typescript
// ✅ 推荐：使用类型安全的查询
import { eq, and, desc, count } from 'drizzle-orm'

// 分页查询
async function getProjectsPaginated(organizationId: string, page = 1, limit = 10) {
  const db = await getDbAsync()
  
  const offset = (page - 1) * limit
  
  const [projects, totalCount] = await Promise.all([
    db
      .select()
      .from(project)
      .where(eq(project.organizationId, organizationId))
      .limit(limit)
      .offset(offset)
      .orderBy(desc(project.createdAt)),
    
    db
      .select({ count: count() })
      .from(project)
      .where(eq(project.organizationId, organizationId))
  ])
  
  return {
    projects,
    total: totalCount[0].count,
    page,
    limit,
    totalPages: Math.ceil(totalCount[0].count / limit)
  }
}

// ✅ 推荐：使用事务处理复杂操作
async function createProjectWithLimits(data: {
  name: string
  userId: string
  organizationId: string
}) {
  const db = await getDbAsync()
  
  return await db.transaction(async (tx) => {
    // 检查项目数量限制
    const subscription = await tx
      .select()
      .from(subscriptionLimit)
      .where(and(
        eq(subscriptionLimit.organizationId, data.organizationId),
        eq(subscriptionLimit.isActive, true)
      ))
      .limit(1)
    
    if (!subscription.length) {
      throw new Error('无有效订阅')
    }
    
    const currentProjectCount = await tx
      .select({ count: count() })
      .from(project)
      .where(eq(project.organizationId, data.organizationId))
    
    if (currentProjectCount[0].count >= subscription[0].projectNums) {
      throw new Error('已达到项目数量限制')
    }
    
    // 创建项目
    const [newProject] = await tx
      .insert(project)
      .values({
        name: data.name,
        userId: data.userId,
        organizationId: data.organizationId,
        templateType: 'nextjs'
      })
      .returning()
    
    // 初始化使用统计
    await tx.insert(projectAIUsage).values({
      projectId: newProject.id,
      organizationId: data.organizationId
    })
    
    return newProject
  })
}
```

### 性能优化建议

```typescript
// ✅ 使用索引优化查询
// 在频繁查询的字段上添加索引
export const projectIndex = index('project_org_user_idx')
  .on(project.organizationId, project.userId)

// ✅ 使用部分索引优化特定查询
export const activeProjectIndex = index('active_project_idx')
  .on(project.organizationId)
  .where(eq(project.isActive, true))

// ✅ 批量操作优化
async function bulkUpdateProjects(updates: Array<{id: string, name: string}>) {
  const db = await getDbAsync()
  
  // 使用批量更新而不是循环单独更新
  const promises = updates.map(update => 
    db
      .update(project)
      .set({ name: update.name, updatedAt: new Date() })
      .where(eq(project.id, update.id))
  )
  
  await Promise.all(promises)
}
```

## 🎯 解决的问题

### 1. 数据库操作类型安全
- **传统问题**：SQL 查询易出错，缺乏类型检查
- **解决方案**：Drizzle ORM 提供编译时类型检查
- **优势**：开发阶段发现错误，减少运行时异常

### 2. 环境配置复杂性
- **传统问题**：开发和生产环境配置不一致
- **解决方案**：智能环境检测和自动适配
- **优势**：相同代码多环境运行，降低配置错误

### 3. 数据库连接性能
- **传统问题**：Serverless 环境下连接延迟高
- **解决方案**：Cloudflare Hyperdrive 加速
- **优势**：显著提升数据库访问性能

### 4. 数据模型维护
- **传统问题**：数据模型分散，缺乏统一管理
- **解决方案**：集中式 Schema 定义和版本控制
- **优势**：数据结构一致性，易于维护和扩展

### 5. 开发效率
- **传统问题**：数据库操作代码重复，缺乏抽象
- **解决方案**：统一的数据访问层和工具函数
- **优势**：提高开发效率，减少重复代码

## 📖 相关资源

- **Drizzle ORM 官方文档**: [https://orm.drizzle.team/](https://orm.drizzle.team/)
- **Cloudflare Hyperdrive**: [https://developers.cloudflare.com/hyperdrive/](https://developers.cloudflare.com/hyperdrive/)
- **PostgreSQL 文档**: [https://www.postgresql.org/docs/](https://www.postgresql.org/docs/)
- **React Cache API**: [https://react.dev/reference/react/cache](https://react.dev/reference/react/cache)

## 🤝 贡献指南

欢迎贡献代码和建议！

### 贡献方式
- 🐛 **Bug 报告**：发现问题请提交 Issue
- 💡 **功能建议**：新功能想法欢迎讨论
- 📝 **文档改进**：帮助完善文档内容
- 🔧 **代码贡献**：提交 Pull Request

### 开发流程
1. Fork 项目仓库
2. 创建功能分支
3. 开发和测试
4. 提交 Pull Request
5. 代码审查和合并

### Schema 贡献指南
- 遵循现有的命名约定和代码风格
- 添加完整的 TypeScript 类型定义
- 提供详细的字段注释和使用说明
- 确保迁移文件的向后兼容性
