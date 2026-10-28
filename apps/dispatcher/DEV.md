# @quickxbuild/dispatcher Development Guide

> High-performance request dispatch service based on Cloudflare Workers

Version: 1.0.0
Last Updated: 2025-07-30

## Table of Contents

- [@quickxbuild/dispatcher Development Guide](#quickxbuilddispatcher-development-guide)
  - [Table of Contents](#table-of-contents)
  - [Overview](#overview)
  - [Core Features](#core-features)
    - [🚀 Routing \& Dispatch](#-routing--dispatch)
    - [🔐 Authentication \& Security](#-authentication--security)
    - [📊 Monitoring \& Debugging](#-monitoring--debugging)
    - [🎯 Developer Tools](#-developer-tools)
  - [Technical Architecture](#technical-architecture)
    - [🏗️ Core Technology Stack](#️-core-technology-stack)
    - [🔐 Security Architecture](#-security-architecture)
  - [Directory Structure](#directory-structure)
    - [Architecture Design](#architecture-design)
      - [Routing Flow](#routing-flow)
      - [Custom Domain Flow](#custom-domain-flow)
  - [Environment Setup](#environment-setup)
    - [Prerequisites](#prerequisites)
    - [Environment Variables](#environment-variables)
    - [Installation](#installation)
  - [Development Guide](#development-guide)
    - [Quick Start](#quick-start)
    - [wrangler.jsonc Configuration](#wranglerjsonc-configuration)
    - [API Testing \& Documentation](#api-testing--documentation)
      - [API Documentation Access](#api-documentation-access)
      - [Health Checks](#health-checks)
      - [Worker Dispatch Testing](#worker-dispatch-testing)
      - [Subdomain Routing Testing](#subdomain-routing-testing)
    - [Core Feature Implementation](#core-feature-implementation)
      - [Main Entry File (src/index.ts)](#main-entry-file-srcindexts)
      - [Dispatch Logic Implementation (src/routes/dispatch.ts)](#dispatch-logic-implementation-srcroutesdispatchts)
      - [Domain Validation Implementation (src/config/domains.ts)](#domain-validation-implementation-srcconfigdomainsts)
    - [Routing Strategies](#routing-strategies)
      - [1. Subdomain Routing (Primary Strategy) ✅](#1-subdomain-routing-primary-strategy-)
      - [2. Custom Domain Routing (New Feature) ✅](#2-custom-domain-routing-new-feature-)
      - [3. Path Routing (API Access) ✅](#3-path-routing-api-access-)
      - [4. Query Parameter Routing ✅](#4-query-parameter-routing-)
    - [Worker Name Rules](#worker-name-rules)
    - [Domain Configuration](#domain-configuration)
    - [Authentication System (Simplified Implementation)](#authentication-system-simplified-implementation)
    - [Error Handling (Structured Implementation)](#error-handling-structured-implementation)
  - [API Reference](#api-reference)
    - [Health Checks](#health-checks-1)
      - [Basic Health Check](#basic-health-check)
      - [Detailed Health Check](#detailed-health-check)
    - [Dispatch Service](#dispatch-service)
      - [Get Namespace Information](#get-namespace-information)
      - [Path Dispatch](#path-dispatch)
      - [Query Parameter Dispatch](#query-parameter-dispatch)
    - [Developer Tools](#developer-tools)
      - [API Documentation](#api-documentation)
      - [OpenAPI Specification](#openapi-specification)
  - [Deployment Guide](#deployment-guide)
    - [Prerequisites](#prerequisites-1)
    - [Resource Configuration](#resource-configuration)
      - [Hyperdrive Connection Pool](#hyperdrive-connection-pool)
      - [Dispatch Namespace](#dispatch-namespace)
    - [Environment Deployment](#environment-deployment)
      - [Development Environment](#development-environment)
      - [Production Environment](#production-environment)
    - [Custom Domains](#custom-domains)
    - [User Worker Deployment](#user-worker-deployment)
    - [Deployment Verification](#deployment-verification)
  - [Troubleshooting](#troubleshooting)
    - [Common Issues](#common-issues)
      - [Q: Subdomain cannot be accessed](#q-subdomain-cannot-be-accessed)
      - [Q: Worker deployment failed](#q-worker-deployment-failed)
      - [Q: Database connection failed](#q-database-connection-failed)
    - [Performance Optimization](#performance-optimization)
    - [Debugging Tools](#debugging-tools)
      - [Log Viewing](#log-viewing)
      - [Performance Monitoring](#performance-monitoring)
  - [Related Resources](#related-resources)
    - [Documentation](#documentation)
    - [Internal Resources](#internal-resources)
    - [Related Tools](#related-tools)

## Overview

`@quickxbuild/dispatcher` is the core request dispatch service of the QuickXBuild platform, built on Cloudflare Workers edge computing architecture. It implements an intelligent routing system that supports wildcard subdomains and custom domains, efficiently distributing user requests to corresponding Worker scripts, providing global high-performance, low-latency distribution services.

## Core Features

### 🚀 Routing & Dispatch
| Feature | Description | Technical Characteristics |
|---------|-------------|---------------------------|
| **Wildcard Subdomain Routing** | Supports dynamic subdomain routing in `*.quickxbuild.sh` format | Automatic subdomain parsing, Worker name validation, RFC 1123 compatible |
| **Custom Domain Support** | Complete custom domain handling and database integration | Database queries, domain validation, project association |
| **Multi-Strategy Routing** | Supports subdomain, path, query parameter routing methods | Flexible routing strategies, intelligent matching |
| **Smart Forwarding** | Automatic request forwarding and response proxying | Complete HTTP method support, header forwarding |

### 🔐 Authentication & Security
| Feature | Description | Limitations |
|---------|-------------|-------------|
| **OpenAPI Integration** | API documentation based on @hono/zod-openapi | Auto-generated docs, type safety |
| **Input Validation** | Strict Worker name and domain format validation | Zod schema validation, error handling |
| **Request Validation** | Request size, headers, format validation | Prevent malicious requests, resource protection |
| **Error Handling** | Unified error handling and request ID tracking | Structured error responses, debugging support |

### 📊 Monitoring & Debugging
| Feature | Description | Security |
|---------|-------------|----------|
| **Health Checks** | Basic and detailed service status checks | Multi-level checks, dependency status |
| **Structured Logging** | Detailed logging based on `@quickxbuild/common` | Request tracking, performance monitoring |
| **API Documentation** | Scalar interactive documentation (OpenAPI 3.1) | Real-time testing, complete specifications |
| **Error Tracking** | Unified error handling and request ID tracking | Issue location, debugging support |

### 🎯 Developer Tools
| Tool | Purpose | Access Path |
|------|---------|-------------|
| **API Documentation** | Scalar interactive documentation (OpenAPI 3.1) | `/docs` |
| **OpenAPI** | API specification export | `/openapi.json` |
| **Health Check** | Service status monitoring | `/health` |
| **Namespace Info** | Dispatch namespace status | `/dispatch` |

## Technical Architecture

### 🏗️ Core Technology Stack
```text
// Runtime Environment
├── Cloudflare Workers    // Edge computing platform
├── Hono v4.8.5          // High-performance web framework
├── TypeScript 5.x       // Type safety guarantee
└── Node.js 24+          // Development environment requirement

// Storage Layer
├── Hyperdrive           // Database connection pool (PostgreSQL)
├── Dispatch Namespace   // Worker dispatch namespace
├── PostgreSQL           // Main database (custom domains)
└── Cache API            // Edge caching

// API Layer
├── @hono/zod-openapi    // OpenAPI integration
├── Zod Schemas          // Runtime validation
├── @scalar/hono-api-ref // API documentation UI
└── @quickxbuild/middleware    // Middleware quickxbuildry

// Advanced Features
├── @quickxbuild/common        // Logging and utility quickxbuildry
├── @quickxbuild/db            // Database abstraction layer
└── drizzle-orm          // ORM query builder
```

### 🔐 Security Architecture
| Layer | Technology | Description |
|-------|------------|-------------|
| **Input Validation** | Zod Schemas | Request/response validation, Worker name verification |
| **Domain Validation** | Custom validators | RFC 1123 compatible, reserved name protection |
| **Error Handling** | Unified error handling | Secure error messages, request tracking |
| **Logging** | @quickxbuild/common | Structured logging, performance monitoring |
| **Request Limits** | Request size validation | Prevent resource abuse, malicious requests |

## Directory Structure

```text
apps/dispatcher/                   # Dispatcher service root directory
├── README.md                      # Basic service documentation
├── DEV.md                         # English development guide
├── DEV_ZH.md                      # Chinese development guide
├── DEPLOYMENT.md                  # Deployment guide
├── package.json                   # Dependencies and script definitions
├── biome.json                     # Code formatting configuration
├── tsconfig.json                  # TypeScript configuration
├── wrangler.jsonc                 # Cloudflare Workers configuration (using compatibility date 2025-07-17)
├── public/                        # Static assets directory
│   └── favicon.ico               # Website icon
├── src/                          # Source code directory
│   ├── index.ts                  # Worker main entry, domain routing and dispatch logic
│   ├── openapi.ts                # OpenAPI application configuration and route registration
│   ├── dispatcher.ts             # Core dispatcher logic and namespace management
│   ├── types.ts                  # Global type definitions and Cloudflare bindings
│   ├── env.ts                    # Environment variable type definitions and validation
│   ├── auth.ts                   # better-auth configuration (simplified version)
│   ├── config/                   # Configuration files directory
│   │   └── domains.ts           # Domain configuration and validation rules
│   ├── routes/                   # API route handlers
│   │   └── dispatch.ts          # Dispatch route handling (path and query parameters)
│   ├── middleware/               # Middleware directory
│   │   └── auth-middleware.ts   # Authentication middleware
│   ├── utils/                    # Utility functions quickxbuildry
│   │   ├── custom-domain.ts     # Custom domain handling logic
│   │   ├── routing.ts           # Route parsing and request building
│   │   ├── validation.ts        # Input validation and format checking
│   │   └── error-handler.ts     # Error handling utilities
│   └── db/                       # Database related
│       ├── db-postgres.ts       # PostgreSQL database configuration
│       └── custom-domain.ts     # Custom domain database operations
└── node_modules/                 # Dependencies directory
```

### Architecture Design

#### Routing Flow

```text
User Request: https://vite-shadcn-template.quickxbuild.sh/
    ↓
Cloudflare DNS: *.quickxbuild.sh → quickxbuild-dispatcher Worker
    ↓
Dispatcher parses subdomain: "vite-shadcn-template"
    ↓
Validate Worker name format (RFC 1123)
    ↓
Call: env.dispatcher.get("vite-shadcn-template")
    ↓
Forward request to user Worker
    ↓
Return Worker response to user
```

#### Custom Domain Flow

```text
User Request: https://myapp.example.com/
    ↓
Dispatcher detects non-quickxbuild.sh domain
    ↓
Query database for domain-associated project
    ↓
Get project's corresponding Worker name
    ↓
Forward to corresponding Worker
    ↓
Return response to user
```

## Environment Setup

### Prerequisites

```bash
# Required tools
node >= 24.0.0
bun >= 1.0.0
wrangler >= 4.25.0

# Install Wrangler globally
npm install -g wrangler

# Cloudflare authentication
wrangler auth login
```

### Environment Variables

Create a `.dev.vars` file in the `apps/dispatcher` directory, you can start from the example file:

```bash
# Copy example file
cp apps/dispatcher/.dev.vars.example apps/dispatcher/.dev.vars

# Edit environment variables
nano apps/dispatcher/.dev.vars
```

Configuration items based on `.dev.vars.example`:

```bash
# GitHub OAuth (required for authentication)
BETTER_GITHUB_CLIENT_ID="your_github_client_id"
BETTER_GITHUB_CLIENT_SECRET="your_github_client_secret"

# Cloudflare settings (required for dispatcher operations)
CLOUDFLARE_ACCOUNT_ID="your_cloudflare_account_id"
DATABASE_ID="your_d1_database_id"
CLOUDFLARE_API_TOKEN="your_cloudflare_api_token"

# Security settings (required for authentication)
TURNSTILE_SECRET_KEY="your_turnstile_secret_key"

# Database (optional for dispatcher)
POSTGRES_URL="your_postgres_connection_string"

# Email service (optional)
RESEND_FROM="noreply@yourdomain.com"
RESEND_API_KEY="your_resend_api_key"

# Payment service (optional)
STRIPE_SECRET_KEY="your_stripe_secret_key"
STRIPE_WEBHOOK_SECRET="your_stripe_webhook_secret"

# Notes:
# 1. Most configurations are preset in wrangler.jsonc vars section
# 2. .dev.vars is mainly used to override sensitive information
# 3. Cloudflare resources (Hyperdrive, Dispatch Namespace) are configured through wrangler.jsonc
```

### Installation

```bash
# Enter Dispatcher directory
cd apps/dispatcher

# Install dependencies (execute in project root)
cd ../../ && bun install

# Return to Dispatcher directory
cd apps/dispatcher

# Create environment variables file (if needed)
touch .dev.vars

# Edit environment variables
nano .dev.vars
```

## Development Guide

### Quick Start

```bash
# Start development server
bun dev

# Service will be available at:
# - Local: http://localhost:3005
# - API Documentation: http://localhost:3005/docs
# - Health Check: http://localhost:3005/health
```

### wrangler.jsonc Configuration

```jsonc
{
  "$schema": "../../node_modules/wrangler/config-schema.json",
  "name": "quickxbuild-dispatcher",
  "main": "src/index.ts",
  "compatibility_date": "2025-07-17",
  "compatibility_flags": ["nodejs_compat", "global_fetch_strictly_public"],
  "assets": {
    "binding": "ASSETS",
    "directory": "public"
  },
  "minify": true,
  "placement": { "mode": "smart" },

  // Database connection pool
  "hyperdrive": [
    {
      "binding": "HYPERDRIVE",
      "id": "your_hyperdrive_id",
      "localConnectionString": "postgresql://postgres:postgres@quickxbuild:5432/quickxbuild"
    }
  ],

  // Worker dispatch namespace
  "dispatch_namespaces": [
    {
      "binding": "dispatcher",
      "namespace": "quickxbuild-dispatcher"
    }
  ],

  // Wildcard subdomain routing (SaaS mode)
  "routes": [
    {
      "pattern": "*/*",
      "zone_name": "quickxbuild.sh"
    }
  ],

  // Monitoring configuration
  "observability": {
    "enabled": true,
    "head_sampling_rate": 1
  },

  // Environment variables
  "vars": {
    "DISPATCH_NAMESPACE_NAME": "quickxbuild-dispatcher",
    "NEXT_PUBLIC_APP_URL": "http://localhost:3000",
    "BETTER_AUTH_SECRET": "your_secret_key",
    "POSTGRES_URL": "your_postgres_url",
    "LOG_LEVEL": "DEBUG"
  }
}
```

### API Testing & Documentation

#### API Documentation Access

```bash
# After starting the service, access auto-generated API documentation
open http://localhost:3005/docs

# View OpenAPI specification
curl http://localhost:3005/openapi.json
```

#### Health Checks

```bash
# Basic health check
curl http://localhost:3005/health

# Detailed health check
curl http://localhost:3005/health/detailed
```

#### Worker Dispatch Testing

```bash
# Path dispatch (requires corresponding Worker deployment)
curl http://localhost:3005/dispatch/my-worker/api/test

# Query parameter dispatch
curl "http://localhost:3005/dispatch?worker=my-worker"

# Get namespace information
curl http://localhost:3005/dispatch
```

#### Subdomain Routing Testing

```bash
# Test subdomain routing (requires DNS configuration)
curl https://my-worker.quickxbuild.sh/

# Test custom domain (requires database configuration)
curl https://myapp.example.com/
```

### Core Feature Implementation

#### Main Entry File (src/index.ts)

```typescript
import { Scalar } from '@scalar/hono-api-reference'
import { Hono } from 'hono'
import { openApiApp } from './openapi'
import { dispatchRoute } from './routes/dispatch'
import { isValidWorkerSubdomain, extractSubdomain } from './config/domains'
import { handleCustomDomainRequest } from './utils/custom-domain'
import { log } from '@quickxbuild/common'

import type { CloudflareBindings, ContextVariables } from './types'
```

#### Dispatch Logic Implementation (src/routes/dispatch.ts)

```typescript
import { Hono } from 'hono'
import { dispatchToWorker, getNamespaceInfo } from '../dispatcher'
import { parseRouteInfo, createWorkerRequest } from '../utils/routing'
import { validateDispatchRequest, validateRequestHeaders, validateRequestSize } from '../utils/validation'
import { log, tryCatch } from '@quickxbuild/common'

export const dispatchRoute = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// Get namespace information and routing help
dispatchRoute.get('/', async (c) => {
  const requestId = c.get('requestId') || crypto.randomUUID()
  const session = c.get('userSession')

  log.dispatcher('info', 'Namespace info request received', {
    requestId,
    operation: 'namespace_info',
    hasSession: !!session
  })
```

#### Domain Validation Implementation (src/config/domains.ts)

```typescript
/**
 * Extract subdomain from hostname
 */
export function extractSubdomain(hostname: string): string | null {
  if (!hostname.endsWith('.quickxbuild.sh')) {
    return null
  }

  const subdomain = hostname.replace('.quickxbuild.sh', '')
  return subdomain || null
}

/**
 * Validate if subdomain is a valid Worker name
 */
export function isValidWorkerSubdomain(subdomain: string): ValidationResult {
  return isValidWorkerName(subdomain)
}
```

### Routing Strategies

#### 1. Subdomain Routing (Primary Strategy) ✅

This is the recommended routing method, providing the best performance and user experience:

```text
# Standard QuickXBuild subdomain
https://your-worker.quickxbuild.sh/ → Worker "your-worker"
https://vite-template.quickxbuild.sh/about → Worker "vite-template" + /about path
```

#### 2. Custom Domain Routing (New Feature) ✅

Complete support for user custom domains through database project association:

```text
# User-bound custom domain
https://myapp.example.com/ → Query database → Corresponding Worker
https://blog.mysite.org/posts → Custom domain + path forwarding
```

#### 3. Path Routing (API Access) ✅

Suitable for API calls and programmatic access:

```text
https://quickxbuild.sh/dispatch/your-worker/path/to/resource
https://quickxbuild.sh/api/dispatch/your-worker/api/endpoint
```

#### 4. Query Parameter Routing ✅

Suitable for simple Worker calls:

```text
https://quickxbuild.sh/dispatch?worker=your-worker
https://quickxbuild.sh/dispatch?worker=my-app&debug=true
```

### Worker Name Rules

Based on the actual implementation in `src/config/domains.ts`:

```typescript
export function isValidWorkerSubdomain(subdomain: string): { valid: boolean; error?: string } {
  if (!subdomain || subdomain.trim() === '') {
    return { valid: false, error: 'Subdomain is required' }
  }

  // Check if subdomain is reserved
  if (DOMAIN_CONFIG.reservedSubdomains.includes(subdomain.toLowerCase())) {
    return { valid: false, error: `Subdomain '${subdomain}' is reserved` }
  }

  // Basic format validation
  if (!/^[a-zA-Z0-9-]+$/.test(subdomain)) {
    return { valid: false, error: 'Subdomain can only contain letters, numbers, and hyphens' }
  }

  // Length validation
  if (subdomain.length > 63) {
    return { valid: false, error: 'Subdomain must be 63 characters or less' }
  }

  // Cannot start or end with hyphen
  if (subdomain.startsWith('-') || subdomain.endsWith('-')) {
    return { valid: false, error: 'Subdomain cannot start or end with a hyphen' }
  }

  return { valid: true }
}
```

**Validation Rules**:

- Can contain uppercase/lowercase letters, numbers, and hyphens
- Length 1-63 characters
- Cannot start or end with hyphens
- Cannot use reserved names (api, www, cdn, dispatcher, etc.)
- Returns detailed validation results and error messages

### Domain Configuration

Based on actual code, domain handling strategy:

**Domain Handling Strategy**:

1. **Smart Routing**: Automatically detects QuickXBuild domains vs custom domains
2. **Database Integration**: Custom domains associated with projects through database queries
3. **Reserved Name Protection**: Prevents use of system-reserved subdomains
4. **Flexible Configuration**: Supports arbitrary custom domain binding

### Authentication System (Simplified Implementation)

Dispatcher uses a simplified better-auth integration:

```typescript
export function getBetterAuth() {
  return betterAuth({
    database: getDB(),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    // Use minimal plugins to avoid environment variable issues
    plugins: []
  })
}
```

**Features**:
- **Simplified Configuration**: Avoids complex environment variable dependencies
- **Basic Authentication**: Supports email/password login
- **Session Management**: Automatic user session handling
- **API Routes**: `/api/auth/**` handles all authentication requests

### Error Handling (Structured Implementation)

Uses `@quickxbuild/common` `tryCatch` pattern:

```typescript
// Unified error handling pattern
const [result, error] = await tryCatch(async () => {
  // Business logic
  return await performOperation()
})

if (error) {
  log.dispatcher('error', 'Operation failed', { context }, error)
  return c.json({ error: 'Internal server error' }, 500)
}

return result
```

**Error Types**:
- `Worker not found` (404)
- `Invalid worker name format` (400)
- `Internal dispatch error` (500)
- `Database connection failed` (503)

## API Reference

### Health Checks

#### Basic Health Check

```http
GET /health
```

Response:

```json
{
  "status": "healthy",
  "timestamp": "2025-07-22T12:00:00.000Z",
  "service": "QuickXBuild Dispatcher",
  "version": "0.0.0",
  "environment": "development"
}
```

#### Detailed Health Check

```http
GET /health/detailed
```

Response:

```json
{
  "status": "healthy",
  "timestamp": "2025-07-22T12:00:00.000Z",
  "service": "QuickXBuild Dispatcher",
  "version": "0.0.0",
  "environment": "development",
  "checks": {
    "hyperdrive": {
      "status": "available",
      "connection_pool": "active"
    },
    "dispatcher": {
      "status": "available",
      "namespace": "quickxbuild-dispatcher"
    }
  }
}
```

### Dispatch Service

#### Get Namespace Information

```http
GET /dispatch
```

Response:

```json
{
  "service": "QuickXBuild Dispatcher",
  "namespace": "quickxbuild-dispatcher",
  "status": "available",
  "timestamp": "2025-07-22T12:00:00.000Z",
  "requestId": "uuid-string"
}
```

#### Path Dispatch

```http
ALL /dispatch/:workerName/*
```

**Examples**:

```bash
# Forward to Worker "my-app" /api/users path
curl https://quickxbuild.sh/dispatch/my-app/api/users

# POST request forwarding
curl -X POST https://quickxbuild.sh/dispatch/blog-app/posts \
  -H "Content-Type: application/json" \
  -d '{"title": "Hello World"}'
```

#### Query Parameter Dispatch

```http
ALL /dispatch?worker=:workerName
```

**Examples**:

```bash
# Simple Worker call
curl "https://quickxbuild.sh/dispatch?worker=my-app"

# With additional query parameters
curl "https://quickxbuild.sh/dispatch?worker=my-app&debug=true&env=staging"
```

### Developer Tools

#### API Documentation

```http
GET /docs
```

Access Scalar interactive API documentation interface.

#### OpenAPI Specification

```http
GET /openapi.json
```

Get complete OpenAPI 3.1.0 specification.

## Deployment Guide

### Prerequisites

1. **Cloudflare Account Setup**
   - Active Cloudflare account
   - Workers service enabled
   - Configure Hyperdrive connection pool
   - Configure Dispatch Namespace

2. **Authentication Setup**
   ```bash
   wrangler auth login
   wrangler whoami
   ```

### Resource Configuration

#### Hyperdrive Connection Pool

```bash
# Create Hyperdrive connection pool
wrangler hyperdrive create quickxbuild-hyperdrive --connection-string="postgresql://user:password@host:port/database"

# List connection pools
wrangler hyperdrive list
```

#### Dispatch Namespace

```bash
# Create Dispatch Namespace
wrangler dispatch-namespace create quickxbuild-dispatcher

# List namespaces
wrangler dispatch-namespace list
```

### Environment Deployment

#### Development Environment

```bash
# Start development server
bun dev

# Development server will start at http://localhost:3005
```

#### Production Environment

```bash
# Set production environment secrets
wrangler secret put BETTER_AUTH_SECRET --env production
wrangler secret put POSTGRES_URL --env production
wrangler secret put BETTER_GITHUB_CLIENT_SECRET --env production

# Deploy to production
bun run deploy
```

### Custom Domains

```bash
# Add custom domain routes
wrangler route add "*.quickxbuild.sh/*" quickxbuild-dispatcher

# View current routes
wrangler route list
```

### User Worker Deployment

Deploy Workers for each project to dispatch namespace:

```bash
# Deploy example project
wrangler deploy --name vite-shadcn-template --dispatch-namespace quickxbuild-dispatcher

# Deploy other projects
wrangler deploy --name my-react-app --dispatch-namespace quickxbuild-dispatcher
```

### Deployment Verification

Visit the following URLs to verify deployment:

- `https://vite-shadcn-template.quickxbuild.sh/` (requires corresponding Worker deployment)
- `https://my-react-app.quickxbuild.sh/` (requires corresponding Worker deployment)
- `https://dispatcher.quickxbuild.dev/health` (Dispatcher health check)

## Troubleshooting

### Common Issues

#### Q: Subdomain cannot be accessed

```bash
# Check DNS configuration
dig *.quickxbuild.sh

# Check Worker deployment status
wrangler status

# View real-time logs
wrangler tail quickxbuild-dispatcher
```

#### Q: Worker deployment failed

```bash
# Check namespace
wrangler dispatch-namespace list

# Redeploy
wrangler deploy --name worker-name --dispatch-namespace quickxbuild-dispatcher

# Check Hyperdrive configuration
wrangler hyperdrive list
```

#### Q: Database connection failed

- Check Hyperdrive configuration
- Verify PostgreSQL connection string
- Confirm database permission settings
- Check if environment variable POSTGRES_URL is correctly set

### Performance Optimization

1. **Caching Strategy**: Utilize Cloudflare's global cache network
2. **Request Optimization**: Reduce unnecessary database queries
3. **Error Handling**: Fast-fail mechanism to avoid timeouts

### Debugging Tools

#### Log Viewing

```bash
# View Worker logs
wrangler tail quickxbuild-dispatcher

# Real-time monitoring
wrangler tail quickxbuild-dispatcher --format pretty
```

#### Performance Monitoring

- Cloudflare Dashboard → Workers → quickxbuild-dispatcher → Analytics
- View request volume, error rates, response times, and other metrics

## Related Resources

### Documentation

- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Cloudflare Dispatch Namespace Documentation](https://developers.cloudflare.com/workers/runtime-apis/bindings/dispatch-namespace/)
- [Cloudflare Hyperdrive Documentation](https://developers.cloudflare.com/hyperdrive/)
- [Hono Documentation](https://hono.dev/)
- [OpenAPI 3.1 Specification](https://spec.openapis.org/oas/v3.1.0)

### Internal Resources

- `@quickxbuild/common` - Shared utility quickxbuildry (logging, error handling)
- `@quickxbuild/middleware` - Middleware quickxbuildry
- `@quickxbuild/db` - Database abstraction layer
- `apps/web` - Main web application
- `apps/cdn` - CDN service

### Related Tools

- [Scalar API Documentation](https://github.com/scalar/scalar) - API documentation generation
- [Zod](https://zod.dev/) - TypeScript schema validation
- [Drizzle ORM](https://orm.drizzle.team/) - TypeScript ORM
- [Biome](https://biomejs.dev/) - Code formatting and linting