# QuickXBuild Email 包开发指南

QuickXBuild Email 是 QuickXBuild 平台的核心邮件系统，基于 **React Email** 和 **Resend** 构建的现代化邮件解决方案。该包提供完整的邮件模板系统、可重用的UI组件库以及类型安全的邮件发送API，支持多种业务场景的邮件通信需求。

## 🎯 功能概览

### 核心能力
- **React 组件化邮件模板**：使用 JSX 语法开发邮件模板
- **类型安全的 API**：完整 TypeScript 支持，智能代码补全
- **响应式设计系统**：基于 RGB 色彩系统和 Tailwind CSS
- **高可靠性发送**：集成 Resend 邮件服务
- **跨客户端兼容**：支持主流邮件客户端渲染

### 业务场景
- 用户注册验证、登录验证码
- 欢迎邮件、订阅确认
- 团队邀请、组织协作
- 订阅取消、联系表单

## 📁 项目结构

```
packages/email/
├── components/                    # 可重用邮件组件
│   ├── button.tsx                # 按钮组件 (4种变体)
│   ├── content-section.tsx       # 内容区块包装器
│   ├── email-container.tsx       # 邮件基础容器
│   ├── email-header.tsx          # 邮件头部
│   ├── email-footer.tsx          # 邮件底部
│   ├── info-box.tsx             # 信息提示框
│   ├── otp-code.tsx             # 验证码显示
│   └── index.ts                 # 组件导出
├── templates/                     # 邮件模板
│   └── emails/
│       ├── cancellation-email.tsx    # 订阅取消
│       ├── contact.tsx               # 联系表单
│       ├── email-verification.tsx    # 邮箱验证
│       ├── organization-invitation.tsx # 团队邀请
│       ├── sign-in.tsx              # 登录验证
│       ├── welcomeEmail.tsx         # 欢迎邮件
│       └── index.tsx               # 模板导出与主题映射
├── utils/
│   └── email.ts                 # 邮件发送工具函数
├── env.mjs                      # 环境变量配置
├── index.ts                     # 包主入口
├── package.json                 # 依赖配置
├── tsconfig.json               # TypeScript 配置
└── tsup.config.ts              # 构建配置
```

## 🛠️ 安装与配置

### 1. 环境配置

```bash
# 安装依赖
bun install

# 配置环境变量 (.env)
RESEND_API_KEY=re_xxxxxxxxxxxxx
RESEND_FROM=noreply@yourdomain.com
```

### 2. 环境变量验证

包使用 `@t3-oss/env-nextjs` 进行类型安全的环境变量验证：

```typescript
// env.mjs
import { createEnv } from '@t3-oss/env-nextjs'
import { z } from 'zod'

export const env = createEnv({
  server: {
    RESEND_FROM: z.string().min(1).email(),
    RESEND_API_KEY: z.string().min(1),
  },
  runtimeEnv: {
    RESEND_FROM: process.env['RESEND_FROM'],
    RESEND_API_KEY: process.env['RESEND_API_KEY'],
  },
})
```

### 3. Resend 配置

```typescript
// index.ts
import { Resend } from 'resend'
import { env } from './env.mjs'

export const resend = new Resend(env.RESEND_API_KEY)
```

## 🧩 组件系统

### 容器组件

#### EmailContainer
邮件基础容器，提供统一布局和样式：

```typescript
interface EmailContainerProps {
  title: string              // HTML 标题
  previewText: string        // 邮件预览文本
  children: React.ReactNode  // 邮件内容
  backgroundColor?: string   // 背景色覆盖
}

// 使用示例
<EmailContainer 
  title="欢迎使用 QuickXBuild" 
  previewText="开始您的 AI 开发之旅"
>
  {/* 邮件内容 */}
</EmailContainer>
```

#### ContentSection
内容区块包装器：

```typescript
interface ContentSectionProps {
  children: React.ReactNode
  className?: string
}
```

### 交互组件

#### Button
支持4种样式变体的按钮组件：

```typescript
interface ButtonProps {
  href: string
  children: React.ReactNode
  variant?: 'primary' | 'secondary' | 'outline' | 'destructive'
  className?: string
}

// 使用示例
<Button href="https://quickxbuild.dev" variant="primary">
  立即开始
</Button>
<Button href="/docs" variant="outline">
  查看文档
</Button>
```

#### InfoBox
信息提示框组件：

```typescript
interface InfoBoxProps {
  title?: string
  children: React.ReactNode
  variant?: 'info' | 'success' | 'warning' | 'error'
}

// 使用示例
<InfoBox variant="success" title="账户激活">
  您的账户已成功激活！
</InfoBox>
```

#### OtpCode
验证码显示组件：

```typescript
interface OtpCodeProps {
  code: string
  className?: string
}

// 使用示例
<OtpCode code="123456" />
```

## 📧 预制模板

### 1. 欢迎邮件 (WelcomeEmailTemplate)

```typescript
interface WelcomeEmailTemplateProps {
  planName: string
}

// 功能特点
- 动态计划名称显示
- 产品功能介绍
- 行动号召按钮
- 帮助中心链接
```

### 2. 登录验证 (SignInTemplate)

```typescript
interface SignInTemplateProps {
  otp: string
}

// 安全特性
- 验证码突出显示
- 10分钟有效期提醒
- 安全提示信息
```

### 3. 邮箱验证 (EmailVerificationTemplate)

```typescript
interface EmailVerificationTemplateProps {
  otp: string
}

// 验证流程
- 6位数字验证码
- 有效期说明
- 重新发送指引
```

### 4. 团队邀请 (OrganizationInvitationTemplate)

```typescript
interface OrganizationInvitationTemplateProps {
  invitedByUsername: string
  invitedByEmail: string
  teamName: string
  inviteLink: string
}

// 协作功能
- 邀请人信息展示
- 团队详情介绍
- 一键接受邀请
- 7天有效期提醒
```

### 5. 订阅取消 (CancellationEmailTemplate)

```typescript
// 无需参数
interface CancellationEmailTemplateProps {}

// 客户关怀
- 取消确认通知
- 反馈收集链接
- 重新订阅选项
- 联系支持渠道
```

### 6. 联系表单 (ContactTemplate)

```typescript
interface ContactTemplateProps {
  name: string
  email: string
  message: string
}

// 客户服务
- 消息内容格式化
- 自动回复确认
- 响应时间说明
```

## 🔧 API 参考

### 邮件发送工具

#### sendWelcomeEmail
发送欢迎邮件：

```typescript
await sendWelcomeEmail(userEmail: string, planName: string)

// 内部实现
await resend.emails.send({
  from: env.RESEND_FROM,
  to: [userEmail],
  subject: `Welcome to the QuickXBuild ${planName} Plan`,
  react: React.createElement(WelcomeEmailTemplate, { planName }),
})
```

#### sendCancellationEmail
发送取消订阅确认：

```typescript
await sendCancellationEmail(userEmail: string)

// 实现细节
- 使用预定义主题："QuickXBuild Subscription Cancelled"
- 自动错误处理和日志记录
```

#### sendOrganizationInvitation
发送团队邀请：

```typescript
await sendOrganizationInvitation({
  email: string
  invitedByUsername: string
  invitedByEmail: string
  teamName: string
  inviteLink: string
})

// 邀请流程
- 个性化邀请内容
- 安全的邀请链接
- 邀请人信息验证
```

### 自定义邮件发送

```typescript
import { resend } from '@quickxbuild/email'
import { render } from '@react-email/render'
import React from 'react'

// 方法1：使用 React 组件 (推荐)
await resend.emails.send({
  from: env.RESEND_FROM,
  to: ['user@example.com'],
  subject: '主题',
  react: React.createElement(YourTemplate, props) as React.ReactElement,
})

// 方法2：使用渲染的 HTML
const html = render(<YourTemplate {...props} />)
await resend.emails.send({
  from: env.RESEND_FROM,
  to: ['user@example.com'],
  subject: '主题',
  html,
})
```

## 🎨 设计系统

### OKLCH 色彩定义

```css
/* 核心颜色变量 */
:root {
  --brand: oklch(65.01% 0.162 33.16);           /* 品牌主色 */
  --background: oklch(98% 0.005 0);             /* 背景色 */
  --foreground: oklch(25% 0.01 0);              /* 前景色 */
  --muted: oklch(95% 0.01 0);                   /* 次要背景 */
  --muted-foreground: oklch(50% 0.01 0);        /* 次要前景 */
  --border: oklch(90% 0.01 0);                  /* 边框色 */
}
```

### 响应式设计

所有组件支持以下断点：
- **桌面端**：最大宽度 600px
- **移动端**：自适应宽度，优化触摸操作
- **邮件客户端**：兼容 Outlook、Gmail、Apple Mail

### 字体系统

```css
font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
```

## 🚀 开发工作流

### 本地开发

```bash
# 启动开发环境
bun dev

# 运行类型检查
bun typecheck

# 执行构建
bun build

# 运行测试
bun test
```

### 模板预览

使用独立的邮件预览应用：

```bash
# 启动预览服务
cd ../../apps/email
bun dev

# 访问预览界面查看所有模板
```

### 创建自定义模板

1. **创建模板文件**

```typescript
// templates/emails/custom-notification.tsx
import React from 'react'
import { EmailContainer, ContentSection, Button, InfoBox } from '../../components'

interface CustomNotificationProps {
  userName: string
  actionUrl: string
  urgencyLevel: 'low' | 'medium' | 'high'
}

export const CustomNotificationTemplate: React.FC<CustomNotificationProps> = ({
  userName,
  actionUrl,
  urgencyLevel
}) => {
  const urgencyColors = {
    low: 'info',
    medium: 'warning', 
    high: 'error'
  } as const

  return (
    <EmailContainer
      title="系统通知"
      previewText={`${userName}，您有新的系统通知`}
    >
      <ContentSection>
        <h1>您好，{userName}！</h1>
        
        <InfoBox 
          variant={urgencyColors[urgencyLevel]} 
          title="系统通知"
        >
          根据您的账户活动，我们检测到需要您的注意。
        </InfoBox>

        <Button href={actionUrl} variant="primary">
          立即查看详情
        </Button>
      </ContentSection>
    </EmailContainer>
  )
}
```

2. **添加到导出列表**

```typescript
// templates/emails/index.tsx
export { CustomNotificationTemplate } from './custom-notification'

export const emailSubjects = {
  'custom-notification': '系统通知 - 需要您的注意',
  // ... 其他主题
}
```

3. **创建发送函数**

```typescript
// utils/custom-email.ts
import { resend } from '../index'
import { env } from '../env.mjs'
import { CustomNotificationTemplate } from '../templates/emails/custom-notification'
import React from 'react'

export async function sendCustomNotification(
  userEmail: string, 
  userName: string, 
  actionUrl: string,
  urgencyLevel: 'low' | 'medium' | 'high' = 'medium'
) {
  try {
    await resend.emails.send({
      from: env.RESEND_FROM,
      to: [userEmail],
      subject: '系统通知 - 需要您的注意',
      react: React.createElement(CustomNotificationTemplate, {
        userName,
        actionUrl,
        urgencyLevel
      }) as React.ReactElement,
    })
  } catch (error) {
    console.error(`[Email] Failed to send custom notification to ${userEmail}:`, error)
    throw error
  }
}
```

### 测试模板

```typescript
// 在预览应用中测试
import { CustomNotificationTemplate } from '@quickxbuild/email/templates/emails/custom-notification'

export default function TestCustomNotification() {
  return (
    <CustomNotificationTemplate 
      userName="张三"
      actionUrl="https://quickxbuild.dev/dashboard/alerts"
      urgencyLevel="high"
    />
  )
}
```

## 🔍 调试指南

### 常见问题

1. **邮件未发送**
   ```bash
   # 检查环境变量
   echo $RESEND_API_KEY
   echo $RESEND_FROM
   
   # 验证 Resend API 密钥
   curl -X GET "https://api.resend.com/emails" \
     -H "Authorization: Bearer $RESEND_API_KEY"
   ```

2. **样式显示异常**
    - 检查 RGB 色彩值格式
    - 验证 Tailwind 类名拼写
    - 测试不同邮件客户端渲染

3. **TypeScript 类型错误**
   ```bash
   # 重新生成类型定义
   bun run typecheck
   
   # 检查组件接口定义
   ```

### 日志记录

所有邮件发送函数都包含错误日志：

```typescript
// 日志格式
console.error(`[Email] Failed to send welcome email to ${userEmail}:`, error)
```

### 性能监控

```typescript
// 监控邮件发送性能
const startTime = Date.now()
await sendWelcomeEmail(email, plan)
const duration = Date.now() - startTime
console.log(`[Email] Welcome email sent in ${duration}ms`)
```

## 📋 最佳实践

### 邮件设计
- **简洁明了**：关键信息突出，避免过度装饰
- **移动优先**：优先考虑移动端显示效果
- **品牌一致**：使用统一的色彩和字体系统
- **可访问性**：确保足够的对比度和可读性

### 代码组织
- **组件复用**：优先使用现有组件
- **类型安全**：为所有 props 定义 TypeScript 接口
- **错误处理**：包含完整的错误捕获和日志记录
- **性能优化**：避免过大的邮件内容和图片

### 安全考虑
- **敏感信息**：避免在邮件中包含敏感数据
- **链接验证**：确保所有链接指向安全域名
- **权限控制**：验证发送权限和收件人有效性

## 🔗 相关资源

- **React Email 文档**: https://react.email/docs
- **Resend API 文档**: https://resend.com/docs/api-reference

---

**QuickXBuild Email** - 现代化、类型安全的邮件解决方案 ✨