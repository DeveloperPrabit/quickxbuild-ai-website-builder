[CmdletBinding()]
param(
  [switch]$UseDocker,
  [string]$PostgresUrl
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Test-PostgresConnection([string]$ConnectionString) {
  if (Get-Command psql -ErrorAction SilentlyContinue) {
    try {
      & psql $ConnectionString -Atqc 'SELECT 1' 2>$null | Out-Null
      if ($LASTEXITCODE -eq 0) {
        return $true
      }
    } catch {
      # Fall through to a TCP check. Bun/Drizzle will provide the detailed error.
    }
  }

  try {
    $match = [regex]::Match($ConnectionString, '^postgres(?:ql)?://(?:[^@/]+@)?(?<host>[^:/]+)(?::(?<port>\d+))?/')
    if (-not $match.Success) {
      return $false
    }

    $hostName = $match.Groups['host'].Value
    $port = if ($match.Groups['port'].Success) { [int]$match.Groups['port'].Value } else { 5432 }
    return (Test-NetConnection -ComputerName $hostName -Port $port -InformationLevel Quiet)
  } catch {
    return $false
  }
}

function Invoke-DatabaseMigration {
  Write-Host 'Applying PostgreSQL migrations...' -ForegroundColor Cyan
  & bun run db:migrate:local
  if ($LASTEXITCODE -ne 0) {
    throw 'PostgreSQL migration failed.'
  }
}

if ($UseDocker) {
  Write-Host 'Starting the Docker PostgreSQL and web services...' -ForegroundColor Cyan
  & docker compose --profile local-db up --build -d
  if ($LASTEXITCODE -ne 0) {
    throw 'Docker Compose failed to start.'
  }
  Write-Host 'QuickXBuild is available at http://localhost:3001' -ForegroundColor Green
  exit 0
}

if (-not $PostgresUrl) {
  $PostgresUrl = $env:POSTGRES_URL
}

if (-not $PostgresUrl) {
  $PostgresUrl = 'postgresql://quickxbuild:quickxbuild@localhost:5432/quickxbuild'
}

$env:POSTGRES_URL = $PostgresUrl
if (Test-PostgresConnection $PostgresUrl) {
  Write-Host 'Detected a reachable PostgreSQL database. Existing data will be preserved.' -ForegroundColor Green
  Invoke-DatabaseMigration
  Write-Host 'Database is ready. Start QuickXBuild with: bun run dev:web:local' -ForegroundColor Green
  exit 0
}

Write-Host 'No reachable PostgreSQL connection was detected.' -ForegroundColor Yellow
Write-Host 'Checked POSTGRES_URL and the local psql client.' -ForegroundColor Yellow

if (Get-Command docker -ErrorAction SilentlyContinue) {
  $answer = Read-Host 'Start the isolated Docker PostgreSQL + QuickXBuild stack now? [Y/n]'
  if ([string]::IsNullOrWhiteSpace($answer) -or $answer -match '^(y|yes)$') {
    & docker compose --profile local-db up --build -d
    if ($LASTEXITCODE -ne 0) {
      throw 'Docker Compose failed to start.'
    }
    Write-Host 'QuickXBuild is available at http://localhost:3001' -ForegroundColor Green
    exit 0
  }
}

Write-Host ''
Write-Host 'Next steps:' -ForegroundColor Cyan
Write-Host '1. Start PostgreSQL, create the quickxbuild database, and set POSTGRES_URL in .env.'
Write-Host '2. Run: bun run db:migrate:local'
Write-Host '3. Run: bun run dev:web:local'
exit 1
