# QuickXBuild Dispatcher 服务

![版本](https://img.shields.io/badge/version-0.0.0-blue)

![许可证](https://img.shields.io/badge/license-AGPL--3.0-green)

---

## 概述

**@quickxbuild/dispatcher** 是一个基于 Cloudflare Workers 的请求路由层，能够将通配符子域名、自定义域名和 RESTful 路径映射到其目标 Worker 应用程序。它提供全球范围内的低延迟调度，并具有企业级安全性。

* 基于 Cloudflare Workers 的边缘优先无服务器架构

* 使用 TypeScript 5.x 和 Hono v4.8+ 构建

* 支持 `*.quickxbuild.sh`、自定义域名和查询调度的智能路由

* 通过 **@quickxbuild/auth**（better-auth）进行企业身份验证

* 结构化日志、健康检查和限额感知速率限制

## 功能

| 类别 | 亮点 |

|----------|------------|

| **路由引擎** | 通配符子域名、自定义域名、路���和查询调度 |

| **安全性** | Bearer token 身份验证、CORS、输入验证、保留子域名保护 |

| **可观察性** | 健康端点、结构化日志、请求跟踪 |

| **开发者体验** | 热重载开发服务器（Wrangler）、Biome 校验、Bun 脚本 |

| **数据库支持** | Cloudflare D1（自定义域名查找）+ Hyperdrive 池 |

| **可扩展性** | 在 300+ 个 Cloudflare PoP 运行，无冷启动 |

## 目录结构（简要）

```text
apps/dispatcher/
├── src/
│ ├── routes/ # 健康检查 | 调度
│ ├── utils/ # 路由 | 验证 | 自定义域名助手
│ ├── auth.ts # better-auth 配置（简化）
│ └── index.ts # Worker 入口点和全局中间件
├── DEPLOYMENT.md # 部署指南
├── wrangler.jsonc # Worker 配置
└── .dev.vars.example
```

## 快速入门（开发）

```bash
# 1. 安装仓库依赖
bun install

# 2. 准备环境变量
cp apps/dispatcher/.dev.vars.example apps/dispatcher/.dev.vars
nano apps/dispatcher/.dev.vars

# 3. 启动本地开发服务器（端口 3007）
cd apps/dispatcher
bun dev
```

关键 URL：

* 健康检查：<http://localhost:3007/health>

* 示例调度：<http://localhost:3007/dispatch?worker=your-worker>

**示例 - 子域名路由（生产环境）：**

```text
# DNS 记录：*.quickxbuild.sh → quickxbuild-dispatcher

# 请求自动路由到 Worker "vite-shadcn-template"
https://vite-shadcn-template.quickxbuild.sh/about
```

## 必需环境变量

| 键 | 描述 | 必需 |

|-----|-------------|----------|

| `BETTER_GITHUB_CLIENT_ID` | GitHub OAuth 客户端 ID，用于身份验证 | ✅ **必需** |

| `BETTER_GITHUB_CLIENT_SECRET` | GitHub OAuth 客户端密钥，用于身份验证 | ✅ **必需** |

| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账户 ID，用于调度操作 | ✅ **必需** |

| `DATABASE_ID` | Cloudflare D1 数据库 ID | ✅ **必需** |

| `CLOUDFLARE_API_TOKEN` | Cloudflare API 令牌，用于操作 | ✅ **必需** |

| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile 机密，用于人类验证 | ✅ **必需** |

| `POSTGRES_URL` | PostgreSQL 数据库连接字符串 | 🔧 可选 |

| `STRIPE_SECRET_KEY` | Stripe 支付处理机密密钥 | 🔧 可选 |

| `STRIPE_WEBHOOK_SECRET` | Stripe webhook 机密，用于支付事件 | 🔧 可选 |

| `RESEND_FROM` | 通知的电子邮件发送地址 | 🔧 可选 |

| `RESEND_API_KEY` | Resend API 密钥，用于电子邮件服务 | 🔧 可选 |

## Bun/NPM 脚本

| 脚本 | 描述 |

|--------|-------------|

| `bun dev` | `wrangler dev`，带有实时重载（端口 3007） |

| `bun run deploy` | 使用环境变量部署到 Cloudflare Workers |

| `bun run cf-typegen` | 生成 Cloudflare 类型定义 |

| `bun run typecheck` | 运行 TypeScript 类型检查 |

| `bun run with-env` | 使用环境变量运行命令 |

| `bun update` | 升级依赖 |

## 部署

```bash
# 身份验证一次
wrangler auth login

# 部署（生产环境）
bun run deploy
```

添加生产环境路由（通配符）：

```bash
wrangler route add "*.quickxbuild.sh/*" quickxbuild-dispatcher-prod
```

## API 和路由参考

### 身份验证矩阵

| 端点 | 身份验证 | 目的 |

|----------|------|---------|

| `GET /health` | ❌ | 健康检查 / 准备就绪探测 |


| `*.quickxbuild.sh/*`（通配符） | ✅/❌* | 子域名路由；您的应用程序决定 |

> *通配符请求转发到您的应用程序 Worker，它可以决定自己的身份验证要求。*

### 速率限制

默认 Cloudflare WAF 规则适用。可以通过 `createRateLimitMiddleware` 配置自定义用户限制。

## 故障排除

### 常见问题

#### 端口已占用（3007）

```bash
# 杀死现有进程
lsof -ti:3007 | xargs kill -9

# 或使用不同端口
bun dev --port 3008
```

#### 环境变量未加载

```bash
# 确保 .dev.vars 文件存在且格式正确
cp apps/dispatcher/.dev.vars.example apps/dispatcher/.dev.vars

# 使用实际值编辑文件
nano apps/dispatcher/.dev.vars
```

#### Wrangler 身份验证问题

```bash
# 重新身份验证 Cloudflare
wrangler auth login

# 验证身份验证
wrangler whoami
```

#### 数据库连接错误

* 验证 `DATABASE_ID` 和 `CLOUDFLARE_ACCOUNT_ID` 是否正确

* 检查 `POSTGRES_URL` 格式：`postgresql://user:password@host:port/database`

* 确保 Hyperdrive 配置正确设置

#### Worker 部署失败

* 检查 `wrangler.jsonc` 配置

* 验证所有必需环境变量是否已设置

* 确保您具有适当的 Cloudflare 权限

### 获取帮助

* 查看 [DEV.md](./DEV.md) 以获取详细的开发指南

* 查看 [DEPLOYMENT.md](./DEPLOYMENT.md) 以获取部署说明

* 在存储库中打开问题报告 bug 或功能请求

## 进一步阅读

* [DEV.md](./DEV.md) – 完整的英文开发指南

* [DEV_ZH.md](./DEV_ZH.md) – 完整的中文开发指南

* [DEPLOYMENT.md](./DEPLOYMENT.md) – 部署指南

* [DEPLOYMENT_ZH.md](./DEPLOYMENT_ZH.md) – 部署指南

* Cloudflare Workers 文档 – <https://developers.cloudflare.com/workers/>

* Hono 框架 – <https://hono.dev/>

---

2025 QuickXBuild. 遵循 AGPL-3.0 许可。