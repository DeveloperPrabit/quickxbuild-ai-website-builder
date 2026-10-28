# @quickxbuild/auth

A comprehensive authentication and authorization solution built on the better-auth framework, optimized for Cloudflare Workers with integrated Stripe payment processing and subscription management.

## 🚀 Features

- **🔐 Authentication & Authorization**: Complete user authentication system with multiple login methods
- **💳 Stripe Integration**: Full subscription lifecycle management with payment processing
- **☁️ Cloudflare Optimized**: Built specifically for Cloudflare Workers environment
- **🗄️ Database Management**: Drizzle ORM with D1 database support
- **📧 Email System**: Automated email notifications for auth and subscription events
- **🔒 Security**: Session management, CSRF protection, OAuth nonce validation
- **🏢 Organizations**: Multi-tenant organization and team management
- **🪝 Webhooks**: Complete webhook handling for third-party service integration

## 📦 Installation

```bash
bun add @quickxbuild/auth
```

## 🛠️ Dependencies

This package requires several peer dependencies:

```bash
# Core authentication framework
bun add better-auth better-auth-harmony stripe drizzle-orm

# QuickXBuild-specific packages (automatically installed in monorepo)
bun add @quickxbuild/better-auth-cloudflare @quickxbuild/better-auth-stripe
bun add @quickxbuild/email @quickxbuild/db @quickxbuild/common @quickxbuild/ui
```

> **Note**: This package uses `better-auth-harmony` (v1.2.5+) which provides enhanced email authentication features. The core `better-auth` package is included as a peer dependency.

## ⚙️ Environment Variables

```env
# Required - GitHub OAuth
BETTER_GITHUB_CLIENT_ID=your_github_client_id
BETTER_GITHUB_CLIENT_SECRET=your_github_client_secret

# Optional - Stripe Payment (required for subscription features)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Required - Cloudflare
CLOUDFLARE_ACCOUNT_ID=your_account_id
DATABASE_ID=your_d1_database_id
CLOUDFLARE_API_TOKEN=your_api_token

# Required - Security
TURNSTILE_SECRET_KEY=your_turnstile_secret

# Required - Admin Configuration
ADMIN_USER_IDS=user_id_1,user_id_2  # Comma-separated list of admin user IDs

# Required - Email Service (for OTP and notifications)
# Note: RESEND_API_KEY is configured in @quickxbuild/email package
RESEND_API_KEY=re_...  # Resend API key for email delivery

# Optional - Development
NODE_ENV=development  # Set to 'production' for production environment
LOG_LEVEL=info        # Logging level (debug, info, warn, error)
```

## 🚀 Quick Start

### Server Setup

```typescript
import { initAuth } from '@quickxbuild/auth/auth-server'

// Initialize auth instance
const auth = await initAuth()

// Use in your API routes
export default auth.handler
```

### Client Setup

```typescript
import { authClient, signIn, signOut, useSession } from '@quickxbuild/auth/auth-client'

// In your React component
function AuthComponent() {
  const { data: session, isPending } = useSession()

  const handleSignIn = async () => {
    // Use email OTP for passwordless authentication
    await signIn.emailOtp({
      email: 'user@example.com'
    })
  }

  if (isPending) return <div>Loading...</div>
  if (!session) return <button onClick={handleSignIn}>Sign In</button>

  return (
    <div>
      Welcome, {session.user.name}!
      <button onClick={() => signOut()}>Sign Out</button>
    </div>
  )
}
```

### Subscription Management

```typescript
import { getSubscriptionUsage, checkAndUpdateAIMessageUsage } from '@quickxbuild/auth/utils/subscription-limits'

// Check subscription usage
const usage = await getSubscriptionUsage(organizationId)
console.log(`AI Messages: ${usage.aiNums}/${usage.aiNumsLimit}`)

// Deduct AI message quota
const success = await checkAndUpdateAIMessageUsage(organizationId)
if (!success) {
  throw new Error('AI quota exceeded')
}
```

## 📚 Documentation

- **[Development Guide (EN)](./DEV.md)** - Comprehensive development documentation
- **[开发指南 (中文)](./DEV_ZH.md)** - 中文版开发文档
- **[OAuth Nonce Security](./utils/README.md)** - OAuth replay attack protection

## 🏗️ Architecture

```text
@quickxbuild/auth
├── auth-client.ts          # Client-side authentication
├── auth-server.ts          # Server-side authentication
├── plugins.ts              # better-auth plugins configuration
├── env.mjs                 # Environment configuration
├── db/                     # Database schemas and migrations
│   ├── index.ts           # Database connection utilities
│   ├── schema.ts          # Combined schema exports
│   ├── schema/            # Individual schema definitions
│   └── migrations/        # Database migration files
├── plugins/               # Custom authentication plugins
│   ├── captcha-plugin.ts  # Turnstile captcha integration
│   ├── email-otp-plugin.ts # Email OTP verification
│   ├── organization-plugin.ts # Multi-tenant organization support
│   ├── stripe-plugin.ts   # Stripe subscription integration
│   └── stripe/            # Stripe-specific utilities
├── utils/                 # Utility functions and helpers
│   ├── admin-utils.ts     # Admin management utilities
│   ├── email-service.ts   # Email delivery service
│   ├── nonce.ts           # OAuth nonce validation
│   ├── organization-utils.ts # Organization management
│   ├── subscription-limits.ts # Subscription quota management
│   └── subscription-limits/ # Modular subscription utilities
└── webhooks/              # Webhook event handlers
    ├── stripe-handler.ts  # Stripe webhook exports and re-exports
    ├── handlers/          # Individual webhook handlers
    │   ├── checkout-handlers.ts  # Checkout session handlers
    │   ├── price-handlers.ts     # Price event handlers
    │   └── product-handlers.ts   # Product event handlers
    ├── shared/            # Shared webhook utilities
    │   ├── constants.ts   # Webhook constants
    │   └── types.ts       # Webhook type definitions
    └── utils/             # Webhook utility functions
        └── subscription-analysis.ts  # Subscription analysis utilities
```

## 🔧 Core APIs

### Authentication

```typescript
// Client-side
import { authClient } from '@quickxbuild/auth/auth-client'
// Or use the exported functions directly
import { signIn, signOut, signUp, useSession } from '@quickxbuild/auth/auth-client'

// Server-side
import { initAuth } from '@quickxbuild/auth/auth-server'
```

### Subscription Utilities

```typescript
import {
  getSubscriptionUsage,
  checkAndUpdateAIMessageUsage,
  createOrUpdateSubscriptionLimit,
  checkAndUpdateEnhanceUsage,
  checkAndUpdateProjectUsage,
  checkAndUpdateDeployUsage
} from '@quickxbuild/auth/utils/subscription-limits'
```

### Organization Management

```typescript
// Import from plugins (re-exported for convenience)
import { getActiveOrganization } from '@quickxbuild/auth/plugins'

// Or import directly from utils
import { getActiveOrganization } from '@quickxbuild/auth/utils/organization-utils'
```

### Database Access

```typescript
import { getAuthDb } from '@quickxbuild/auth/db'
```

### Webhook Handling

```typescript
// Import individual webhook handlers
import {
  handleProductCreatedOrUpdated,
  handleProductDeleted,
  handlePriceCreatedOrUpdated,
  handlePriceDeleted
} from '@quickxbuild/auth/webhooks/stripe-handler'

// Or use the better-auth-stripe plugin's built-in webhook endpoint
import { initAuth } from '@quickxbuild/auth/auth-server'
const auth = await initAuth()
// Webhook endpoint available at: /api/auth/stripe/webhook
```

## 🔌 Plugin System

The auth package includes several powerful plugins:

### Captcha Plugin
- **Turnstile Integration**: Cloudflare Turnstile captcha verification
- **Bot Protection**: Prevents automated attacks on auth endpoints

### Email OTP Plugin
- **Magic Link Authentication**: Passwordless login via email
- **OTP Verification**: One-time password verification system
- **Resend Integration**: Email delivery via Resend service

### Organization Plugin
- **Multi-tenant Support**: Organization-based user management
- **Role-based Access**: Organization-specific user roles and permissions
- **Team Management**: Invite and manage team members

### Stripe Plugin
- **Subscription Management**: Complete subscription lifecycle
- **Payment Processing**: Secure payment handling
- **Webhook Integration**: Real-time payment event processing

## 🪝 Webhook System

### Stripe Webhooks

The auth package provides comprehensive Stripe webhook handling through the better-auth-stripe plugin:

```typescript
// Webhook endpoint is automatically available at /api/auth/stripe/webhook
// when using the stripe plugin in your auth configuration

// For custom webhook handling, import individual handlers:
import {
  handleProductCreatedOrUpdated,
  handleProductDeleted,
  handlePriceCreatedOrUpdated,
  handlePriceDeleted
} from '@quickxbuild/auth/webhooks/stripe-handler'
```

### Supported Events

**Subscription Events** (handled by better-auth-stripe plugin):
- `checkout.session.completed` - New subscription creation
- `customer.subscription.updated` - Subscription changes
- `customer.subscription.deleted` - Subscription cancellation
- `invoice.payment_succeeded` - Successful payment
- `invoice.payment_failed` - Failed payment

**Product & Pricing Events** (handled by custom handlers):
- `product.created` - New product creation
- `product.updated` - Product information updates
- `product.deleted` - Product removal
- `price.created` - New pricing tier creation
- `price.updated` - Price changes
- `price.deleted` - Price removal

## 🛡️ Security Features

- **Session Management**: Secure session handling with automatic cleanup
- **CSRF Protection**: Built-in CSRF token validation
- **OAuth Nonce Validation**: Replay attack protection for OAuth flows
- **Rate Limiting**: Configurable rate limiting for authentication endpoints
- **Geolocation Tracking**: Track user sessions by geographic location

## 🎯 Use Cases

- **SaaS Applications**: Complete authentication with subscription billing
- **Multi-tenant Platforms**: Organization-based access control
- **API Services**: Secure API authentication with usage quotas
- **E-commerce**: User authentication with payment processing

## 📊 Subscription Plans

The package supports multiple subscription tiers:

- **Free Plan**: Basic usage limits
- **Pro Plan**: Enhanced limits and features  
- **Max Plan**: Maximum limits and premium features

## 🗄️ Database Management

The package includes comprehensive database management tools:

### Available Scripts

```bash
# Generate auth schema from better-auth configuration
bun auth:generate

# Generate database migrations
bun db:generate

# Apply migrations locally
bun db:migrate

# Apply migrations to remote D1 database
bun db:migrate-remote

# Open Drizzle Studio for database inspection
bun db:studio
```

### Schema Management

The database schema is automatically generated from the better-auth configuration and includes:

- **User Management**: Users, sessions, accounts, verification tokens
- **Organization Support**: Organizations, members, invitations
- **Subscription Data**: Plans, subscriptions, usage limits
- **Security**: OAuth nonces, admin roles, rate limiting

## 🐛 Troubleshooting

### Common Issues

1. **D1 Database Connection**: Ensure your D1 database is properly configured and `DATABASE_ID` is set
2. **Stripe Webhooks**: Verify webhook endpoints are properly configured with correct `STRIPE_WEBHOOK_SECRET`
3. **Environment Variables**: Double-check all required environment variables are set
4. **KV Storage**: Ensure KV namespace is bound in your Cloudflare Workers environment
5. **Email Delivery**: Verify `RESEND_API_KEY` is valid and email templates are configured

### Local Development

```bash
# Test D1 database connection
bun wrangler d1 execute quickxbuild --local --command='SELECT 1'

# Run database migrations
bun db:migrate

# Start development with proper environment
bun with-env dev

# Run tests
bun test
```

### Debug Mode

Enable debug logging by setting:

```env
LOG_LEVEL=debug
NODE_ENV=development
```

## 🤝 Contributing

Please refer to the main project's contributing guidelines.

## 📄 License

AGPL-3.0-only - See LICENSE file for details.
