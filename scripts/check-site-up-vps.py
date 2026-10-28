#!/usr/bin/env python3
"""Quick health check of QuickXBuild web on VPS. Requires DEPLOY_PASSWORD."""

from __future__ import annotations

import os
import sys

import paramiko

HOST = os.environ.get("DEPLOY_HOST", "64.247.177.39")
PASSWORD = os.environ.get("DEPLOY_PASSWORD", "")


def main() -> int:
    if not PASSWORD:
        print("DEPLOY_PASSWORD required", file=sys.stderr)
        return 1
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", password=PASSWORD, timeout=60)
    remote = r"""
set +e
echo "=== docker ps ==="
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | head -20
echo "=== web logs ==="
cid=$(docker ps -qf name=quickxbuild-web | head -1)
echo CID=$cid
if [ -n "$cid" ]; then
  echo BUILD=$(docker exec "$cid" cat /workspace/apps/web/.next/BUILD_ID 2>/dev/null)
  docker logs --tail 40 "$cid" 2>&1
  echo "=== curl localhost ==="
  curl -sI --max-time 10 http://127.0.0.1:3000/ | head -15
  docker exec "$cid" sh -lc 'curl -sI --max-time 8 http://127.0.0.1:3000/ | head -12'
else
  echo WEB_DOWN
  docker ps -a --filter name=quickxbuild-web --format 'table {{.Names}}\t{{.Status}}' | head -10
  docker compose -f /opt/quickxbuild/docker-compose.prod.yml -f /opt/quickxbuild/docker-compose.override.prod.yml ps 2>&1 | head -20
fi
echo "=== nginx/caddy? ==="
ss -tlnp | grep -E ':80|:443|:3000' | head -20
echo CHECK_SITE_DONE
"""
    _i, out, err = client.exec_command(remote, timeout=90)
    print((out.read() + err.read()).decode("utf-8", "replace"))
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
