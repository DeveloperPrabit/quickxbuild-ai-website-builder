#!/bin/sh
# Prefer next start when a production BUILD_ID is present (fast page loads).
# Otherwise fall back to next dev with production auth flags.
set -eu

cd /workspace/apps/web

export ENVIRONMENT="${ENVIRONMENT:-production}"
export NEXT_PUBLIC_ENVIRONMENT="${NEXT_PUBLIC_ENVIRONMENT:-production}"
export NEXT_PUBLIC_SCAN="${NEXT_PUBLIC_SCAN:-0}"
export NEXT_TELEMETRY_DISABLED=1
export HOSTNAME="${HOSTNAME:-0.0.0.0}"
export PORT="${PORT:-3000}"
export AUTH_CROSS_SUBDOMAIN="${AUTH_CROSS_SUBDOMAIN:-0}"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1536}"

if [ -f .next/BUILD_ID ] && [ "${FORCE_NEXT_DEV:-0}" != "1" ]; then
  echo "[web-prod] Starting Next.js production server (next start) on :${PORT}"
  export NODE_ENV=production
  exec bun run start
fi

echo "[web-prod] No BUILD_ID — starting next dev with production auth (slow). Upload a prebuilt .next for fast loads."
export NODE_ENV=development
export ENVIRONMENT=production
export NEXT_PUBLIC_ENVIRONMENT=production
export NEXT_PUBLIC_SCAN=0
export AUTH_CROSS_SUBDOMAIN=0
exec bun run dev
