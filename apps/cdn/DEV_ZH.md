# @quickxbuild/cdn 开发指南

> 基于 Cloudflare Workers 的高性能 CDN 服务

版本：0.0.0  
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

`@quickxbuild/cdn` 是 QuickXBuild 平台的核心存储服务，基于 Cloudflare Workers 边缘计算架构构建。提供文件上传、图片处理、截图管理、配额控制等功能，支持全球分布式部署和智能缓存策略。通过与 better-auth 深度集成，实现了完善的认证和授权体系。

## 核心功能

### 🗄️ 文件管理
| 功能 | 说明 | 技术特点 |
|-----|------|----------|
| **智能上传** | 基于 planId 的文件替换管理 | SHA256 去重、自动替换旧文件、最大5MB |
| **分布式存储** | Cloudflare R2 对象存储 | 全球边缘节点、高可用性 |
| **安全删除** | 级联删除关联文件 | KV 映射清理、配额恢复 |
| **高速访问** | 智能缓存策略 | 30天浏览器缓存、边缘缓存 |
| **配额管理** | 用户/组织级别的上传配额 | 自动扣除和恢复、计划限制、1次/10秒限流 |

### 🖼️ 图片处理
| 功能 | 说明 | 限制 |
|-----|------|------|
| **多格式支持** | PNG、JPEG、WebP、SVG、AVIF | 最大 5MB |
| **尺寸标记** | 宽高标识存储 | `{hash}_{width}x{height}.{ext}` |
| **智能压缩** | Cloudflare Images 集成（优选）+ 回退压缩 | 自动格式转换、质量80%优化 |
| **CDN 加速** | 全球节点分发 | Cache-Control: 30天 |
| **内容验证** | MIME 类型校验 + SHA256校验 | 防止恶意文件上传 |

### 📸 截图服务
| 功能 | 说明 | 安全性 |
|-----|------|--------|
| **Base64 存储** | 支持 dataURL 格式 | 认证保护 |
| **快速检索** | planId → key 映射 | 公开读取（iframe） |
| **格式转换** | PNG/JPEG 自动识别 | MIME 类型验证 |
| **TTL 管理** | 90天自动过期 | KV 存储优化 |

### 🎯 开发者工具
| 工具 | 用途 | 访问路径 |
|-----|------|----------|
| **API 文档** | Scalar 交互式文档（OpenAPI 3.1） | `/docs` |
| **Inspector** | 组件实时调试（仅开发环境） | `/inspector` |
| **Badge.js** | "Made with QuickXBuild" 网站徽章 | `/badge.js` |
| **OpenAPI** | API 规范导出 | `/openapi.json` |
| **健康检查** | 服务状态监控 | `/` |
| **静态资源** | 音效、脚本、图标 | `/public/inspect.js`等 |

## 技术架构

### 🏗️ 核心技术栈
```typescript
// 运行时环境
├── Cloudflare Workers    // 边缘计算平台
├── Hono v4.x            // 高性能 Web 框架  
├── TypeScript 5.x       // 类型安全保障
└── Node.js 24+          // 开发环境要求

// 存储层
├── R2 Storage           // 对象存储（文件内容）
├── KV Namespace         // 键值存储（映射关系）
├── D1 Database          // SQLite（可选）
├── Hyperdrive           // 数据库连接池（可选）
└── Cache API            // 边缘缓存

// API 层
├── @hono/zod-openapi    // OpenAPI 集成
├── Zod Schemas          // 运行时验证
├── @scalar/hono-api-ref // API 文档 UI
└── better-auth          // 认证授权框架

// 高级功能（可选）
├── Cloudflare Images    // 图片优化服务
├── Rate Limiting API    // 速率限制
└── @quickxbuild/common        // 日志和工具库
```

### 🔐 安全架构
| 层级 | 技术 | 说明 |
|-----|------|------|
| **认证** | better-auth + @quickxbuild/auth | Bearer Token、Session 管理 |
| **授权** | 中间件链 | 路由级权限控制、公开端点跳过 |
| **限流** | Cloudflare Rate Limiting | 可配置的用户级限制 |
| **验证** | Zod Schemas | 请求/响应验证、文件类型校验 |
| **CORS** | 动态配置 | localhost/quickxbuild.dev 白名单 |
| **加密** | SHA256 | 文件唯一性校验、防重复上传 |
| **配额** | KV 存储 | 用户/组织级别的上传限制 |

## 目录结构

```text
apps/cdn/                          # CDN 服务根目录
├── README.md                      # 基础服务文档
├── package.json                   # 依赖和脚本定义
├── biome.json                     # 代码格式化配置
├── tsconfig.json                  # TypeScript 配置
├── wrangler.jsonc                 # Cloudflare Workers 配置（使用兼容日期2025-07-17）
├── worker-configuration.d.ts      # Cloudflare Workers 环境类型
├── badge-test.html               # Badge 功能测试页面
├── .dev.vars.example             # 环境变量示例
├── src/                          # 源代码目录
│   ├── index.ts                  # Worker 主入口，集成所有路由
│   ├── openapi.ts                # OpenAPI 应用配置和路由注册
│   ├── auth-server.ts            # better-auth 认证配置
│   ├── inspector.ts              # Component Inspector 功能
│   ├── db.ts                     # 数据库配置
│   ├── db-postgres.ts            # PostgreSQL 数据库配置
│   ├── drizzle.config.ts         # Drizzle ORM 配置
│   ├── config/                   # 配置文件目录
│   ├── middleware/               # 中间件目录
│   ├── routes/                   # API 路由处理器
│   │   ├── upload.ts             # 文件上传路由 (PUT /upload)
│   │   ├── image.ts              # 图片访问路由 (GET /image/{key})
│   │   ├── screenshot.ts         # 截图服务路由 (POST /screenshot, GET /screenshot/{planId})
│   │   ├── delete.ts             # 文件删除路由 (DELETE /file/{planId})
│   │   └── badge.ts              # Badge 脚本路由 (GET /badge.js)
│   ├── schemas/                  # Zod 数据验证模式
│   │   ├── upload.ts             # 文件上传验证模式
│   │   ├── image.ts              # 图片访问参数模式
│   │   ├── screenshot.ts         # 截图请求参数模式
│   │   └── delete.ts             # 删除操作验证模式
│   ├── types/                    # 类型定义目录
│   └── utils/                    # 工具函数库
│       ├── __tests__/            # 单元测试
│       ├── common.ts             # 通用工具函数
│       ├── error-handler.ts      # 错误处理工具
│       ├── file-management.ts    # R2 文件管理和 planId 映射工具
│       ├── file-validation.ts    # 文件验证工具
│       ├── quota-management.ts   # 配额管理工具
│       └── screenshot-management.ts # 截图处理工具
└── public/                       # 静态资源目录
    ├── logo.png                  # Logo图标
    ├── inspect.js                # Component Inspector 客户端脚本
    └── notification.wav          # 通知音效
```

## 环境设置

### 前置要求

```bash
# 必需工具
node >= 18.0.0
bun >= 1.0.0
wrangler >= 4.0.0


# Cloudflare 认证
wrangler auth login
```

### 环境变量

在 `apps/cdn` 目录创建 `.dev.vars` 文件：

```bash
# GitHub OAuth 配置
BETTER_GITHUB_CLIENT_ID=your_github_client_id
BETTER_GITHUB_CLIENT_SECRET=your_github_client_secret

# Cloudflare 配置
CLOUDFLARE_ACCOUNT_ID=your_cloudflare_account_id
CLOUDFLARE_API_TOKEN=your_cloudflare_api_token

# 数据库配置
DATABASE_ID=your_database_id
POSTGRES_URL=postgresql://user:password@host:port/database

# 安全配置
TURNSTILE_SECRET_KEY=your_turnstile_secret_key

# 邮件服务配置
RESEND_FROM=noreply@yourdomain.com
RESEND_API_KEY=your_resend_api_key

# 注意：
# 1. 大部分配置已在 wrangler.jsonc 的 vars 部分预设
# 2. .dev.vars 主要用于覆盖敏感信息
# 3. Cloudflare 资源（R2、KV、D1）通过 wrangler.jsonc 配置
```

### 安装

```bash
# 进入 CDN 目录
cd apps/cdn

# 安装依赖（在项目根目录执行）
cd ../../ && bun install

# 返回 CDN 目录
cd apps/cdn

# 创建环境变量文件（如果需要）
touch .dev.vars

# 编辑环境变量
nano .dev.vars
```

## 开发指南

### 快速开始

```bash
# 启动开发服务器
bun dev

# 服务将在以下地址可用：
# - 本地：http://localhost:3004
# - API 文档：http://localhost:3004/docs
# - Inspector：http://localhost:3004/inspector
```

### API 测试与文档

#### API 文档访问

```bash
# 启动服务后，访问自动生成的 API 文档
open http://localhost:3004/docs

# 查看 OpenAPI 规范
curl http://localhost:3004/openapi.json
```

#### 文件上传

```bash
# 上传图片文件（需要认证）
curl -X PUT http://localhost:3004/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "image=@example.jpg" \
  -F "planId=your_plan_id"

# 带尺寸标记的上传（用于响应式图片）
curl -X PUT http://localhost:3004/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "image=@example.jpg" \
  -F "planId=your_plan_id" \
  -F "width=800" \
  -F "height=600"

# 响应示例（返回文件 key）
abc123def456789.jpg                    # 普通上传
abc123def456789_800x600.jpg           # 带尺寸标记的上传
```

#### 图片访问

```bash
# 通过 key 访问图片
curl "http://localhost:3004/image/abc123def456789.jpg"

# 响应头包含缓存策略
# Cache-Control: public, max-age=2592000 (30天)
# Content-Type: image/jpeg
```

#### 截图服务
由专门的截图服务提供

# 检索截图 key（公开访问）
curl "http://localhost:3004/screenshot/your_plan_id"

# 响应示例
{
"key": "screenshot_abc123def456.png",
"planId": "your_plan_id",
"timestamp": 1704067200000
}
```

#### 文件删除

```bash
# 删除文件（需要认证）
curl -X DELETE http://localhost:3004/file/your_plan_id \
  -H "Authorization: Bearer YOUR_TOKEN"

# 响应示例
{
  "success": true,
  "message": "File deleted successfully",
  "fileKey": "abc123def456789.jpg"
}
```

#### Badge 服务

```bash
# 获取 Badge 脚本
curl "http://localhost:3004/badge.js"

# 在网页中使用
<script src="https://cdn.quickxbuild.dev/badge.js"></script>
```

#### Component Inspector

```bash
# 访问 Inspector 界面
open http://localhost:3004/inspector

# 获取 Inspector 客户端脚本
curl "http://localhost:3004/inspect.js"
```

### 核心功能实现

#### 主入口文件 (src/index.ts)

```typescript
import { Scalar } from '@scalar/hono-api-reference'
import { Hono } from 'hono'

import { createErrorHandler } from '@quickxbuild/middleware'
import { createCorsMiddleware } from '@quickxbuild/middleware/cors'
import { createLoggingMiddleware, createRequestIdMiddleware } from '@quickxbuild/middleware/logging'

import { registerInspectorRoutes } from './inspector'
import { openApiApp } from './openapi'
import type { Bindings, Variables } from './types'

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// 应用中间件栈
app.use('*', createRequestIdMiddleware())
app.onError(createErrorHandler('cdn'))
app.use('*', createCorsMiddleware())
app.use('*', createLoggingMiddleware({ service: 'cdn', level: 'info' }))

// 处理 /upload 的 OPTIONS 请求
app.options('/upload', (c) => {
    return c.newResponse(null, 204)
})

// 根路径
app.get('/', async (c) => {
    return c.text('Hello QuickXBuild!')
})

// 注册 Inspector 路由（仅开发环境）
registerInspectorRoutes(app)

// 集成 OpenAPI 应用路由
app.route('/', openApiApp)

// API 文档
app.get('/docs', Scalar({
    url: '/openapi.json',
    theme: 'default',
    pageTitle: 'QuickXBuild CDN API Documentation',
    customCss: `
    .light-mode {
      --scalar-color-accent: #0099ff;
    }
    .dark-mode {
      --scalar-color-accent: #e36002;
    }
  `,
}))

export default app
```

#### 文件上传实现 (src/routes/upload.ts)

```typescript
import { createRoute } from '@hono/zod-openapi'
import { log, logger, LogLevel } from '@quickxbuild/common'
import { sha256 } from 'hono/utils/crypto'
import { getExtension } from 'hono/utils/mime'
import type { z } from 'zod'
import { errorResponseSchema, uploadRequestSchema, uploadResponseSchema } from '../schemas/upload'
import { checkAndUpdateUploadUsage } from '../utils/quota-management'
import { getConfig, uploadConfig } from '../config'
import type { AppContext } from '../types'
import { CDNError, CommonErrors, ErrorCodes, withErrorHandling } from '../utils/error-handler'
import { getStorageBucket, logWithContext } from '../utils/common'
import { sanitizeFileMetadata, validateFile } from '../utils/file-validation'

export const uploadRoute = createRoute({
    method: 'put',
    path: '/upload',
    summary: 'Upload an image file',
    description: 'Upload an image file to R2 storage with optional width and height parameters for resizing',
    tags: ['Images'],
    security: [{ bearerAuth: [] }],
    request: {
        body: {
            content: {
                'multipart/form-data': {
                    schema: uploadRequestSchema
                }
            },
            required: true
        }
    },
    responses: {
        200: {
            description: 'Image uploaded successfully',
            content: {
                'text/plain': {
                    schema: uploadResponseSchema.shape.key
                }
            }
        },
        401: {
            description: 'Unauthorized - Valid session required',
            content: {
                'application/json': {
                    schema: errorResponseSchema
                }
            }
        },
        500: {
            description: 'Internal server error',
            content: {
                'application/json': {
                    schema: errorResponseSchema
                }
            }
        }
    }
})

export const uploadHandler = withErrorHandling(async (c: AppContext) => {
    const requestId = c.get('requestId')
    logWithContext(c, 'info', 'Upload request started', { operation: 'upload' })

    const data = await c.req.parseBody() as { image: File; width: string; height: string; planId: string }
    const file: File = data.image
    const planId: string = data.planId

    // 验证文件和参数
    await validateFile(file, uploadConfig.maxFileSize)

    const type = file.type
    const extension = getExtension(type) ?? 'png'
    const arrayBuffer = await file.arrayBuffer()

    // 生成文件 key
    let key: string
    if (data.width && data.height) {
        key = `${await sha256(arrayBuffer)}_${data.width}x${data.height}.${extension}`
    } else {
        key = `${await sha256(arrayBuffer)}.${extension}`
    }

    // 检查配额并上传文件
    await checkAndUpdateUploadUsage(c, planId)

    const bucket = getStorageBucket(c)
    const metadata = sanitizeFileMetadata({
        planId,
        uploadedAt: new Date().toISOString(),
        contentType: type,
        size: file.size
    })

    await bucket.put(key, arrayBuffer, {
        httpMetadata: { contentType: type },
        customMetadata: metadata
    })

    logWithContext(c, 'info', 'Upload completed successfully', {
        operation: 'upload',
        planId,
        fileKey: key
    })

    return c.text(key)
})
```

## API 参考

### 认证

所有需要认证的接口都需要在请求头中包含有效的 Bearer Token 或 Session：

```bash
# Bearer Token 认证
Authorization: Bearer YOUR_TOKEN

# Session 认证（通过 Cookie）
Cookie: session=YOUR_SESSION_TOKEN
```

**公开端点（无需认证）**：
- `GET /` - 根路径
- `GET /image/{key}` - 图片访问
- `GET /screenshot/{planId}` - 截图检索
- `GET /badge.js` - Badge 脚本
- `GET /inspector` - Inspector UI（仅开发环境）
- `GET /docs` - API 文档
- `GET /openapi.json` - OpenAPI 规范

### 文件上传

#### PUT /upload

上传图片文件到 CDN，基于 planId 进行文件替换管理。

**认证**：必需

**请求体**：
```typescript
{
    image: File,          // 要上传的图片文件
        planId: string,       // 计划 ID（用于文件替换追踪）
        width?: string,       // 可选：图片宽度（用于重尺寸）
        height?: string       // 可选：图片高度（用于重尺寸）
}
```

**响应**：
```
text/plain
abc123def456789.jpg   // 返回生成的文件 key
```

### 图片访问

#### GET /image/{key}

通过文件 key 获取图片。

**认证**：不需要

**路径参数**：
- `key`：文件唯一标识符

**响应**：
- **Content-Type**：image/*
- **Cache-Control**：public, max-age=2592000（30天缓存）

### 截图服务

#### POST /screenshot

存储截图数据。

**认证**：必需

**请求体**：
```typescript
{
    dataUrl: string,      // base64 格式的图片数据 URL
        planId: string,       // 计划 ID
        format?: 'png' | 'jpeg'  // 图片格式（默认 png，支持 png 或 jpeg）
}
```

**响应**：
```typescript
{
    key: string,          // 生成的截图文件 key
        planId: string,       // 计划 ID
        timestamp: number     // 时间戳
}
```

#### GET /screenshot/{planId}

通过 planId 检索截图文件 key。

**认证**：不需要（公开访问，用于 iframe）

**路径参数**：
- `planId`：计划 ID

**响应**：
```typescript
{
    key: string,          // 截图文件 key
        planId: string,       // 计划 ID
        timestamp: number     // 时间戳
}
```

### 文件删除

#### DELETE /file/{planId}

删除与 planId 关联的文件。

**认证**：必需

**路径参数**：
- `planId`：计划 ID

**响应**：
```typescript
{
    success: boolean,     // 操作是否成功
        message: string,      // 操作结果消息
        fileKey?: string      // 被删除的文件 key（可选）
}
```

### Badge 服务

#### GET /badge.js

获取 QuickXBuild Badge JavaScript 脚本。

**认证**：不需要

**响应**：
- **Content-Type**：application/javascript
- 返回可嵌入网站的 Badge 脚本

### 开发工具

#### GET /inspector

访问 Component Inspector 界面。

**认证**：不需要（仅开发环境可用）

**响应**：
- **Content-Type**：text/html
- 返回完整的组件检查器界面

#### GET /inspect.js

获取 Inspector 客户端脚本。

**认证**：不需要

**响应**：
- **Content-Type**：application/javascript
- 返回客户端检查器脚本

#### GET /docs

访问 API 文档界面。

**认证**：不需要

**响应**：
- 基于 Scalar 的现代化 API 文档界面
- 支持交互式 API 测试

#### GET /openapi.json

获取 OpenAPI 规范。

**认证**：不需要

**响应**：
- **Content-Type**：application/json
- 返回完整的 OpenAPI 3.1.0 规范

#### GET /debug/session

调试当前会话结构。

**认证**：必需

**响应**：
```typescript
{
    user: {               // 用户信息
        id: string,
            email: string,
        // ... 其他用户字段
    },
    session: {           // 会话信息
        token: string,
            expiresAt: string,
        // ... 其他会话字段
    }
}
```

### 配额管理

配额系统自动跟踪用户的上传使用情况：

**配额扣除**：
- 文件上传时自动扣除 1 个配额
- 替换同一 planId 的文件不扣除额外配额

**配额恢复**：
- 删除文件时自动恢复 1 个配额
- 基于组织或用户级别管理

**配额限制**：
- 根据用户订阅计划设置
- 超出配额时上传请求将被拒绝

### 速率限制

使用 Cloudflare Rate Limiting API 实现精细控制：

**默认限制**：
- 文件上传：根据配置（如 1次/10秒）
- 基于用户 ID 或 IP 地址

**自定义配置**：
```json
// wrangler.jsonc 中配置
{
  "unsafe": {
    "bindings": [{
      "name": "FILE_UPLOAD_RATE_LIMITER",
      "type": "ratelimit",
      "namespace_id": "1001",
      "simple": {
        "limit": 1,
        "period": 10
      }
    }]
  }
}
```

## 部署指南

### 准备工作

1. **Cloudflare 账户设置**
    - 活跃的 Cloudflare 账户
    - 启用 Workers 服务
    - 配置 R2 存储桶
    - 配置 KV 命名空间
    - 配置 D1 数据库

2. **认证设置**
   ```bash
   wrangler auth login
   wrangler whoami
   ```

### 资源配置

#### R2 存储桶

```bash
# 创建 R2 存储桶
wrangler r2 bucket create quickxbuild-cdn

# 查看存储桶列表
wrangler r2 bucket list
```

#### KV 命名空间

```bash
# 创建 KV 命名空间
wrangler kv:namespace create "CDN_KV"

# 查看命名空间列表
wrangler kv:namespace list
```

#### D1 数据库

```bash
# 创建 D1 数据库
wrangler d1 create quickxbuild

# 查看数据库列表
wrangler d1 list
```

### 环境部署

#### 开发环境

```bash
# 启动开发服务器
bun dev

# 开发服务器将在 http://localhost:3004 启动
```

#### 生产环境

```bash
# 设置生产环境密钥
wrangler secret put BETTER_GITHUB_CLIENT_SECRET --env production
wrangler secret put POSTGRES_URL --env production
wrangler secret put RESEND_API_KEY --env production
wrangler secret put TURNSTILE_SECRET_KEY --env production

# 部署到生产环境
bun run deploy
```

### 自定义域名

```bash
# 添加自定义域名路由
wrangler route add "cdn.quickxbuild.dev/*" quickxbuild-cdn

# 查看当前路由
wrangler route list
```

### wrangler.jsonc 配置

```json
{
  "$schema": "../../node_modules/wrangler/config-schema.json",
  "name": "quickxbuild-cdn",
  "main": "src/index.ts",
  "compatibility_date": "2025-07-30",
  "compatibility_flags": ["nodejs_compat", "global_fetch_strictly_public"],
  "assets": {
    "binding": "ASSETS",
    "directory": "public"
  },
  "routes": [
    {
      "pattern": "quickxbuild.dev",
      "custom_domain": true
    }
  ],
  "minify": true,
  "placement": { "mode": "smart" },
  "hyperdrive": [
    {
      "binding": "HYPERDRIVE",
      "id": "your_hyperdrive_id",
      "localConnectionString": "postgresql://postgres:postgres@quickxbuild:5432/quickxbuild"
    }
  ],
  "d1_databases": [
    {
      "binding": "DATABASE",
      "database_name": "quickxbuild",
      "database_id": "your_database_id"
    }
  ],
  "kv_namespaces": [
    {
      "binding": "KV",
      "id": "your_kv_namespace_id"
    }
  ],
  "r2_buckets": [
    {
      "binding": "BUCKET",
      "bucket_name": "quickxbuild-cdn"
    }
  ],
  "images": {
    "binding": "IMAGES"
  },
  "unsafe": {
    "bindings": [
      {
        "name": "FILE_UPLOAD_RATE_LIMITER",
        "type": "ratelimit",
        "namespace_id": "1001",
        "simple": {
          "limit": 1,
          "period": 10
        }
      }
    ]
  },
  "observability": {
    "enabled": true,
    "head_sampling_rate": 1
  },
  "vars": {
    "LOG_LEVEL": "info",
    "ENVIRONMENT": "development",
    "NODE_ENV": "development",
    "POSTGRES_URL": "postgresql://postgres:postgres@quickxbuild:5432/quickxbuild"
  }
}
```

## 故障排除

### 常见问题

#### 文件上传失败

**症状**：上传请求返回 401 或 500 错误。

**解决方案**：
```bash
# 检查认证状态
curl -X PUT http://localhost:3004/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "image=@test.jpg" \
  -F "planId=test123" -v

# 检查 R2 存储桶配置
wrangler r2 bucket list

# 检查 KV 命名空间
wrangler kv:namespace list

# 查看实时日志
wrangler tail

# 检查文件大小限制（最大 5MB）
ls -lh test.jpg
```

#### 图片访问失败

**症状**：图片访问返回 404 错误。

**解决方案**：
- 确认文件 key 正确
- 检查 R2 存储桶中是否存在文件
- 验证缓存设置

#### 截图服务异常

**症状**：截图存储或检索失败。

**解决方案**：
- 检查 dataUrl 格式是否正确
- 验证 planId 是否有效
- 确认 KV 存储状态

#### Inspector 无法访问

**症状**：Inspector 页面加载失败。

**解决方案**：
- 确认服务运行在正确端口（3004）
- 检查静态资源是否正确加载
- 验证 CORS 配置

#### 认证问题

**症状**：认证相关接口返回 401 错误。

**解决方案**：
```bash
# 检查环境变量
echo $BETTER_GITHUB_CLIENT_ID
echo $BETTER_GITHUB_CLIENT_SECRET

# 验证 better-auth 配置
# 检查 src/auth-server.ts 配置

# 测试认证流程
curl -X GET http://localhost:3004/ \
  -H "Authorization: Bearer YOUR_TOKEN" -v
```


## 相关资源

### 文档
- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [Cloudflare R2 文档](https://developers.cloudflare.com/r2/)
- [Cloudflare KV 文档](https://developers.cloudflare.com/kv/)
- [Cloudflare D1 文档](https://developers.cloudflare.com/d1/)
- [Hono 文档](https://hono.dev/)
- [better-auth 文档](https://better-auth.com/)

### 内部资源
- `@quickxbuild/auth` - 认证工具库
- `@quickxbuild/common` - 共享工具库（日志、错误处理）
- `packages/api` - API 路由定义
- `apps/web` - 主 Web 应用

### 开发工具
- [Scalar API 文档](https://github.com/scalar/scalar) - API 文档生成
- [Zod](https://zod.dev/) - TypeScript 模式验证
- [Biome](https://biomejs.dev/) - 代码格式化和检查
