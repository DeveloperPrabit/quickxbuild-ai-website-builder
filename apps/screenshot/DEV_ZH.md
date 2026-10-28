# @quickxbuild/screenshot 开发指南

> 基于 Cloudflare Workers 的高性能队列式截图服务

版本：1.0.0
最后更新：2025-07-30

## 目录

- [概述](#概述)
- [核心功能](#核心功能)
- [技术栈](#技术栈)
- [目录结构](#目录结构)
- [环境设置](#环境设置)
- [开发指南](#开发指南)
- [API 参考](#api-参考)
- [部署指南](#部署指南)
- [故障排除](#故障排除)
- [相关资源](#相关资源)

## 概述

`@quickxbuild/screenshot` 是 QuickXBuild 平台的核心截图服务，基于 Cloudflare Workers 和 Queues 构建。它实现了异步队列处理架构，解决了同步截图的 30 秒超时限制，支持高并发、可靠的项目预览截图生成，并与沙箱服务和 CDN 服务深度集成。

## 核心功能

### 🚀 异步截图处理

| 功能 | 说明 | 技术特点 |
|-----|------|----------|
| **队列式处理** | 基于 Cloudflare Queues 的异步截图任务处理 | 无超时限制、高并发、自动重试 |
| **批量处理** | 高效的批量消息处理机制 | 可配置并发数、批次大小优化 |
| **状态跟踪** | 完整的截图任务状态管理 | 实时状态更新、进度追踪 |
| **错误恢复** | 智能重试和死信队列机制 | 指数退避、失败任务隔离 |

### 🔐 集成与安全

| 功能 | 说明 | 限制 |
|-----|------|------|
| **沙箱集成** | 复用现有沙箱基础设施进行项目准备 | 支持多种沙箱提供商 |
| **CDN 存储** | 自动上传和管理截图到 CDN | 全球分发、缓存优化 |
| **权限验证** | 基于用户会话的权限控制 | 组织级别权限、审计追踪 |
| **速率限制** | 内置速率限制防止滥用 | 用户级和组织级限制 |

### 📊 监控与调试

| 功能 | 说明 | 安全性 |
|-----|------|--------|
| **健康检查** | 多级服务状态检查 | 队列状态、外部服务连接 |
| **结构化日志** | 基于 `@quickxbuild/common` 的详细日志记录 | 关联 ID、性能指标 |
| **API 文档** | Scalar 交互式文档（OpenAPI 3.1） | 实时测试、完整规范 |
| **队列监控** | 队列积压和处理速率监控 | 实时指标、告警机制 |

### 🎯 开发者工具

| 工具 | 用途 | 访问路径 |
|-----|------|----------|
| **API 文档** | Scalar 交互式文档（OpenAPI 3.1） | `/docs` |
| **OpenAPI** | API 规范导出 | `/openapi.json` |
| **健康检查** | 服务状态监控 | `/health` |
| **截图状态** | 任务状态查询 | `/screenshot-status` |
| **截图提交** | 新截图任务提交 | `/screenshot` |

## 技术架构

### 🏗️ 核心技术栈

```typescript
// 运行时环境
├── Cloudflare Workers    // 边缘计算平台
├── Cloudflare Queues     // 消息队列服务
├── Hono v4.8.5          // 高性能 Web 框架
├── TypeScript 5.8.3     // 类型安全保障
└── Node.js 24+          // 开发环境要求

// 存储层
├── D1 Database          // SQLite 数据库（状态管理）
├── R2 Storage           // 对象存储（截图文件）
├── Cloudflare Browser   // 浏览器渲染 API
└── Cache API            // 边缘缓存

// API 层
├── @hono/zod-openapi v0.19.10    // OpenAPI 集成
├── Zod v4.0.14         // 运行时验证
├── @scalar/hono-api-reference v0.9.11 // API 文档 UI
└── @quickxbuild/middleware    // 中间件库

// 高级功能
├── @quickxbuild/sandbox       // 沙箱服务集成
├── @quickxbuild/common        // 日志和工具库
├── @quickxbuild/db            // 数据库抽象层
└── drizzle-orm v0.44.3  // ORM 查询构建器
```

### 🔐 安全架构

| 层级 | 技术 | 说明 |
|-----|------|------|
| **认证授权** | @quickxbuild/auth | 用户会话验证、组织权限控制 |
| **输入验证** | Zod Schemas | 请求/响应验证、参数校验 |
| **速率限制** | 队列机制 | 自然速率限制、滥用防护 |
| **错误处理** | 统一错误处理 | 安全的错误信息、请求追踪 |
| **数据保护** | 临时文件清理 | 敏感数据加密、安全凭证处理 |

## 目录结构

```text
apps/screenshot/                   # Screenshot 服务根目录
├── README.md                      # 基础服务文档
├── ARCH.md                        # 架构设计文档
├── package.json                   # 依赖和脚本定义
├── tsconfig.json                  # TypeScript 配置
├── vitest.config.ts               # 测试配置
├── wrangler.jsonc                 # Cloudflare Workers 配置（兼容性日期：2025-07-17）
├── wrangler.jsonc.example         # 配置文件示例
├── public/                        # 静态资源目录
│   └── favicon.ico               # 网站图标
├── src/                          # 源代码目录
│   ├── index.ts                  # Worker 主入口，队列处理和路由
│   ├── types/                    # 类型定义目录
│   ├── api/                      # API 路由处理器
│   │   ├── openapi.ts           # OpenAPI 应用配置和路由注册
│   │   └── middleware/          # API 中间件
│   ├── queue/                    # 队列处理逻辑
│   │   ├── producer.ts          # 队列生产者（任务提交）
│   │   └── consumer.ts          # 队列消费者（任务处理）
│   ├── screenshot/               # 截图工作流
│   │   ├── workflow.ts          # 截图工作流编排
│   │   └── steps/               # 工作流步骤
│   │       ├── validate.ts      # 权限和参数验证
│   │       ├── capture.ts       # 截图捕获逻辑
│   │       └── storage.ts       # 存储和上传处理
│   └── utils/                    # 工具函数库
│       ├── logger.ts            # 日志工具
│       └── errors.ts            # 错误处理工具
└── node_modules/                 # 依赖包目录
```

### 架构设计

#### 队列处理流程

```text
用户请求: POST /screenshot
    ↓
队列生产者: 验证参数并创建队列消息
    ↓
Cloudflare Queue: 消息排队等待处理
    ↓
队列消费者: 批量处理消息
    ↓
截图工作流: 执行完整截图流程
    ↓
状态更新: 更新数据库状态
```

#### 工作流状态机

```text
pending → processing → validating → creating_sandbox
    ↓
syncing_files → capturing → storing → completed
    ↓
failed (任何步骤失败时)
```

## 环境设置

### 前置要求

```bash
# 必需工具
Node.js >= 24.0.0
Bun >= 1.0.0
Wrangler >= 4.25.0

# 全局安装 Wrangler CLI
npm install -g wrangler

# Cloudflare 账户认证
wrangler auth login
```

### 环境变量

在 `apps/screenshot` 目录创建 `.dev.vars` 文件：

```bash
# Cloudflare 配置（必需）
CLOUDFLARE_ACCOUNT_ID="your_cloudflare_account_id"
CLOUDFLARE_API_TOKEN="your_cloudflare_api_token"
CLOUDFLARE_ZONE_ID="your_zone_id"

# 数据库配置（必需）
DATABASE_ID="your_d1_database_id"
POSTGRES_URL="your_postgres_connection_string"

# GitHub OAuth（可选）
BETTER_GITHUB_CLIENT_ID="your_github_client_id"
BETTER_GITHUB_CLIENT_SECRET="your_github_client_secret"

# 沙箱服务配置
E2B_API_KEY="your_e2b_api_key"
DAYTONA_API_KEY="your_daytona_api_key"
SANDBOX_BUILDER_DEFAULT_PROVIDER="daytona"

# 应用配置
NEXT_PUBLIC_DISPATCHER_URL="https://quickxbuild.sh"

# 队列配置
SCREENSHOT_QUEUE_NAME="screenshot-queue"
SCREENSHOT_DLQ_NAME="screenshot-dlq"
MAX_SCREENSHOT_TIMEOUT="300000"
MAX_CONCURRENT_SCREENSHOTS="3"

# 开发配置
ENVIRONMENT="development"
LOG_LEVEL="debug"
NODE_ENV="development"

# 重要提示：
# 1. 大部分配置已在 wrangler.jsonc 的 vars 部分预设
# 2. .dev.vars 主要用于覆盖敏感信息和本地开发配置
# 3. Cloudflare 资源（Queues、D1）通过 wrangler.jsonc 配置
# 4. 生产环境请使用 wrangler secret 命令设置敏感变量
```

### 安装

```bash
# 进入 Screenshot 目录
cd apps/screenshot

# 安装依赖（在项目根目录执行）
cd ../../ && bun install

# 返回 Screenshot 目录
cd apps/screenshot

# 复制配置文件模板
cp wrangler.jsonc.example wrangler.jsonc

# 编辑配置文件
nano wrangler.jsonc
```

## 开发指南

### 快速开始

```bash
# 启动开发服务器
bun dev

# 服务将在以下地址可用：
# - 本地：http://localhost:3009
# - API 文档：http://localhost:3009/docs
# - 健康检查：http://localhost:3009/health
```

### API 测试与文档

#### API 文档访问

```bash
# 启动服务后，访问自动生成的 API 文档
open http://localhost:3009/docs

# 查看 OpenAPI 规范
curl http://localhost:3009/openapi.json
```

#### 健康检查

```bash
# 基础健康检查
curl http://localhost:3009/health
```

#### 截图服务测试

```bash
# 提交截图任务（需要认证）
curl -X POST http://localhost:3009/screenshot \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "projectId": "your_project_id",
    "planId": "your_plan_id",
    "orgId": "your_org_id",
    "userId": "your_user_id",
    "previewUrl": "https://example.com"
  }'

# 查询截图状态
curl "http://localhost:3009/screenshot-status?id=screenshot_id"
```

### 测试

```bash
# 运行单元测试
bun test

# 运行测试并生成覆盖率报告
bun run test:coverage

# 类型检查
bun run typecheck
```

### 核心功能实现

#### 主入口文件 (src/index.ts)

<augment_code_snippet path="apps/screenshot/src/index.ts" mode="EXCERPT">
````typescript
import { Hono } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import {
  createCorsMiddleware,
  createLoggingMiddleware,
  createRequestIdMiddleware
} from '@quickxbuild/middleware'
import { handleQueueBatch } from './queue/consumer'
import { openApiApp } from './api/openapi'
import { createLogger } from './utils/logger'

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()
````
</augment_code_snippet>

#### 队列生产者实现 (src/queue/producer.ts)

<augment_code_snippet path="apps/screenshot/src/queue/producer.ts" mode="EXCERPT">
````typescript
/**
 * 提交截图请求到队列
 */
export async function submitScreenshotRequest(
  env: Bindings,
  params: {
    projectId: string
    planId: string
    orgId: string
    userId: string
    previewUrl?: string
  },
  options?: {
    priority?: boolean
    delaySeconds?: number
    deduplicate?: boolean
    config?: {
      timeout?: number
      skipSteps?: string[]
      debug?: boolean
    }
  }
): Promise<string> {
  const screenshotId = generateScreenshotId()
  const message = createScreenshotMessage(screenshotId, params, options?.config)

  if (options?.priority) {
    await sendPriorityMessage(env, message)
  } else if (options?.deduplicate) {
    const deduplicationKey = createDeduplicationKey(params.projectId, params.planId, params.userId)
    await sendDedupedMessage(env, message, deduplicationKey)
  } else if (options?.delaySeconds) {
    await sendDelayedMessage(env, message, options.delaySeconds)
  } else {
    await sendToQueue(env, message)
  }

  return screenshotId
}
````
</augment_code_snippet>

#### 截图工作流实现 (src/screenshot/workflow.ts)

<augment_code_snippet path="apps/screenshot/src/screenshot/workflow.ts" mode="EXCERPT">
````typescript
/**
 * 执行完整的截图工作流
 */
export class ScreenshotWorkflow {
  private env: Bindings
  private logger: ReturnType<typeof createLogger>
  private stepResults: Record<string, BaseStepResult> = {}

  constructor(
    env: Bindings,
    logger: ReturnType<typeof createLogger>
  ) {
    this.env = env
    this.logger = logger
  }

  /**
   * 执行基于 URL 的截图工作流
   */
  async execute(screenshotId: string, params: ScreenshotParams): Promise<ScreenshotResult> {
    const startTime = Date.now()

    this.logger.info('Starting URL-based screenshot workflow', {
      screenshotId,
      projectId: params.projectId,
      planId: params.planId,
      userId: params.userId,
      organizationId: params.orgId,
      previewUrl: params.previewUrl
    })

    // 验证 previewUrl 是否提供
    if (!params.previewUrl) {
      throw new ScreenshotError(
        400,
        ErrorCodes.INVALID_REQUEST,
        'previewUrl is required for screenshot service'
      )
    }

    // 创建截图上下文
    const context: ScreenshotContext = {
      screenshotId,
      env: this.env,
      params,
      logger: this.logger,
      stepResults: {}
    }

    try {
      // 步骤 1: 验证权限并准备截图
      await this.executeStep(
        'validation',
        'Validating project and preparing screenshot',
        25,
        context,
        validateAndPrepare
      )

      // 步骤 2: 从 URL 捕获截图
      await this.executeStep(
        'capture',
        'Capturing screenshot from URL',
        70,
        context,
        captureScreenshot
      )

      // 步骤 3: 存储截图到 CDN
      await this.executeStep(
        'storage',
        'Storing screenshot to CDN',
        100,
        context,
        storeScreenshot
      )

      const duration = Date.now() - startTime
      const screenshotUrl = this.stepResults.storage?.data?.screenshotUrl

      this.logger.info('Screenshot workflow completed successfully', {
        screenshotId,
        duration,
        screenshotUrl
      })

      return {
        screenshotId,
        status: 'completed' as ScreenshotStatus,
        screenshotUrl: screenshotUrl || '',
        duration
      }

    } catch (error) {
      const duration = Date.now() - startTime

      this.logger.error('Screenshot workflow failed', {
        screenshotId,
        duration,
        error: error instanceof Error ? error.message : String(error)
      }, error instanceof Error ? error : undefined)

      throw error
    }
  }
}
````
</augment_code_snippet>

## API 参考

### 截图服务

#### 提交截图任务

```http
POST /screenshot
```

**认证**：必需

**请求体**：

```typescript
{
  projectId: string,        // 项目 ID
  planId: string,          // 计划 ID
  orgId: string,           // 组织 ID
  userId: string,          // 用户 ID
  previewUrl?: string      // 可选：自定义预览 URL
}
```

**响应**：

```json
{
  "success": true,
  "screenshotId": "screenshot_1721649600000_abc123def",
  "message": "Screenshot request submitted successfully"
}
```

#### 查询截图状态

```http
GET /screenshot-status?id=<screenshotId>
```

**认证**：不需要

**查询参数**：
- `id`：截图任务 ID

**响应**：

```json
{
  "success": true,
  "status": "completed",
  "message": "Screenshot completed successfully",
  "previewImageUrl": "https://cdn.quickxbuild.dev/screenshots/screenshot_1721649600000_abc123def.png"
}
```

### 健康检查

#### 服务健康检查

```http
GET /health
```

**认证**：不需要

**响应**：

```json
{
  "status": "healthy",
  "timestamp": "2025-07-22T12:00:00.000Z",
  "service": "QuickXBuild Screenshot Service",
  "version": "0.0.0",
  "environment": "development",
  "queue": {
    "status": "available",
    "name": "screenshot-queue"
  }
}
```

### 开发工具

#### API 文档

```http
GET /docs
```

访问 Scalar 交互式 API 文档界面。

#### OpenAPI 规范

```http
GET /openapi.json
```

获取完整的 OpenAPI 3.1.0 规范。

## 部署指南

### 准备工作

1. **Cloudflare 账户设置**
   - 活跃的 Cloudflare 账户
   - 启用 Workers 服务
   - 配置 Queues 服务
   - 配置 D1 数据库

2. **认证设置**
   ```bash
   wrangler auth login
   wrangler whoami
   ```

### 资源配置

#### Cloudflare Queues

```bash
# 创建主处理队列
wrangler queues create screenshot-queue

# 创建死信队列
wrangler queues create screenshot-dlq

# 查看队列列表
wrangler queues list
```

#### D1 数据库

```bash
# 创建 D1 数据库（如果不存在）
wrangler d1 create quickxbuild

# 查看数据库列表
wrangler d1 list
```

### 环境部署

#### 开发环境

```bash
# 启动开发服务器
bun dev

# 开发服务器将在 http://localhost:3009 启动
```

#### 生产环境

```bash
# 设置生产环境密钥
wrangler secret put CLOUDFLARE_API_TOKEN --env production
wrangler secret put POSTGRES_URL --env production
wrangler secret put E2B_API_KEY --env production
wrangler secret put DAYTONA_API_KEY --env production

# 部署到生产环境
bun run deploy:prod
```

### 自定义域名

```bash
# 添加自定义域名路由
wrangler route add "screenshot.quickxbuild.dev" quickxbuild-screenshot

# 查看当前路由
wrangler route list
```

### 验证部署

访问以下 URL 验证部署：

- `https://screenshot.quickxbuild.dev/health`

## 故障排除

### 常见问题

#### Q: 队列消息处理失败

```bash
# 检查队列状态
wrangler queues list

# 查看死信队列
wrangler queues consumer list screenshot-dlq

# 查看实时日志
wrangler tail quickxbuild-screenshot
```

#### Q: 截图生成超时

- 检查沙箱服务状态
- 验证浏览器渲染 API 配置
- 确认网络连接稳定性

#### Q: 数据库连接失败

- 检查 D1 数据库配置
- 验证 PostgreSQL 连接字符串
- 确认数据库权限设置

### 性能优化

1. **队列配置**: 调整并发数和批次大小
2. **缓存策略**: 利用 CDN 缓存截图结果
3. **错误处理**: 优化重试策略和超时设置

### 调试工具

#### 日志查看

```bash
# 查看 Worker 日志
wrangler tail quickxbuild-screenshot

# 实时监控
wrangler tail quickxbuild-screenshot --format pretty
```

#### 性能监控

- Cloudflare Dashboard → Workers → quickxbuild-screenshot → Analytics
- 查看队列处理速率、错误率、响应时间等指标

## 相关资源

### 文档
- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [Cloudflare Queues 文档](https://developers.cloudflare.com/queues/)
- [Cloudflare Browser Rendering 文档](https://developers.cloudflare.com/browser-rendering/)
- [Hono 文档](https://hono.dev/)
- [OpenAPI 3.1 规范](https://spec.openapis.org/oas/v3.1.0)

### 内部资源
- `@quickxbuild/sandbox` - 沙箱服务集成
- `@quickxbuild/common` - 共享工具库（日志、错误处理）
- `@quickxbuild/middleware` - 中间件库
- `@quickxbuild/db` - 数据库抽象层
- `apps/cdn` - CDN 服务

### 开发工具
- [Scalar API 文档](https://github.com/scalar/scalar) - API 文档生成
- [Zod](https://zod.dev/) - TypeScript 模式验证
- [Drizzle ORM](https://orm.drizzle.team/) - TypeScript ORM
- [Vitest](https://vitest.dev/) - 单元测试框架
