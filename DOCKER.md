# Local Docker and PostgreSQL Guide

This repository runs the main frontend and backend together in `apps/web`. The web app is a Next.js server, so one web container provides both the browser application and its API routes. PostgreSQL stores project data, quotas, and application data. Authentication data uses the local Cloudflare D1/Wrangler database.

## Fastest Path

Prerequisites:

- Docker Desktop running
- Bun 1.2.21+
- A copied `.env` file

```powershell
Copy-Item .env.example .env
bun run setup:docker
```

The Docker workflow:

1. Starts an isolated PostgreSQL 17 container named `quickxbuild-postgres`.
2. Creates the `quickxbuild` database automatically.
3. Waits for PostgreSQL health checks.
4. Applies `packages/db` Drizzle migrations.
5. Starts the Next.js web application.

Open http://localhost:3001.

Useful commands:

```powershell
bun run docker:logs
bun run docker:down
bun run docker:up
```

The PostgreSQL data is stored in the named Docker volume `quickxbuild-postgres-data`. `docker compose down` keeps that volume. To intentionally delete the Docker database, use:

```powershell
docker compose down -v
```

## Reuse Existing PostgreSQL

The setup script does not delete, reset, or overwrite an existing PostgreSQL database. It tests the connection in `POSTGRES_URL` and runs migrations against that database.

Set the connection in `.env` first:

```env
POSTGRES_URL=postgresql://username:password@localhost:5432/quickxbuild
```

Then run:

```powershell
bun run setup:local
```

A successful run means the configured server was reachable and the existing database schema was migrated. Existing rows remain in place; Drizzle migrations only apply pending schema changes.

### Check PostgreSQL on Windows

Check installed PostgreSQL services:

```powershell
Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue
```

Check a TCP port:

```powershell
Test-NetConnection localhost -Port 5432
Test-NetConnection localhost -Port 5433
```

Check the PostgreSQL client:

```powershell
Get-Command psql -ErrorAction SilentlyContinue
psql --version
```

Check Docker PostgreSQL containers:

```powershell
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Ports}}"
```

If a local server is active but the `quickxbuild` database does not exist, create it using an administrator connection:

```sql
CREATE DATABASE quickxbuild;
```

For example, with `psql`:

```powershell
psql "postgresql://postgres:password@localhost:5432/postgres" -c "CREATE DATABASE quickxbuild;"
```

Then set `POSTGRES_URL` to the new database and run `bun run setup:local`.

## Existing Docker PostgreSQL

If another container already occupies port 5432, do not delete it. Either point `POSTGRES_URL` at its existing database, or use the isolated Compose database on another host port:

```env
POSTGRES_PORT=55432
```

Compose still connects internally to PostgreSQL on port 5432; `POSTGRES_PORT` only controls the host port.

To inspect the Compose database:

```powershell
docker exec -it quickxbuild-postgres psql -U quickxbuild -d quickxbuild
```

## Migration Commands

From the repository root:

```powershell
# Generate a migration after changing packages/db/schema
bun run migration:generate

# Apply migrations to the database in POSTGRES_URL
bun run db:migrate:local
```

The Docker migration service runs the same migration command automatically before the web service starts.

Do not use `git reset`, delete the PostgreSQL volume, or run destructive SQL as a setup step. If you need a clean disposable Docker database, use `docker compose down -v` and then `bun run setup:docker`.

## Environment Separation

- `.env` is used by the local web process and local migration commands.
- Docker Compose passes `POSTGRES_URL` internally as `postgresql://...@postgres:5432/quickxbuild`.
- Do not bake `.env` or API keys into the Docker image.
- AI, email, sandbox, OAuth, and payment features still require their own valid provider keys.
- OpenAI generation does not provide sandbox preview execution. Add `E2B_API_KEY` or `DAYTONA_API_KEY` for cloud sandbox previews, or use the local preview fallback configured by `LOCAL_PREVIEW_URL`.

## Troubleshooting

### `No package found with name 'stripe' in workspace`

The old Turbo filter is not valid for this checkout. Use:

```powershell
bun run dev:web
```

### PostgreSQL connection refused or terminated

1. Check the service or Docker container.
2. Check the port with `Test-NetConnection`.
3. Verify the database name, username, and password in `POSTGRES_URL`.
4. Run `bun run db:migrate:local` after the connection works.

### Preview URL cannot be created

The web app and PostgreSQL can run without a sandbox provider, but generated-app preview execution cannot. Add one of these to `.env` and restart the web service:

```env
E2B_API_KEY=...
# or
DAYTONA_API_KEY=...
NEXT_PUBLIC_SANDBOX_DEFAULT_PROVIDER=daytona
```

### Docker web service cannot resolve PostgreSQL

Inside Compose, the hostname is `postgres`, not `localhost`. `docker-compose.yml` supplies the correct internal `POSTGRES_URL` automatically.
