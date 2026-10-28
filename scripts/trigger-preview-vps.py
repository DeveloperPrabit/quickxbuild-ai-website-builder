#!/usr/bin/env python3
"""Trigger getPreviewUrl for a project via web container logs + internal curl to tRPC if session cookie available.
Falls back to invoking prepareContainer path by hitting the project page API shape and dumping logs.
Requires DEPLOY_PASSWORD.
"""

from __future__ import annotations

import os
import sys
import time

import paramiko

HOST = os.environ.get("DEPLOY_HOST", "64.247.177.39")
PASSWORD = os.environ.get("DEPLOY_PASSWORD", "")
PROJECT_ID = os.environ.get("PROJECT_ID", "kaqz9ypquny655m86hgjwdrp")


def main() -> int:
    if not PASSWORD:
        print("DEPLOY_PASSWORD required", file=sys.stderr)
        return 1
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", password=PASSWORD, timeout=60)

    # Run a node one-shot inside web that exercises E2B sandbox create + preview URL
    # (platform-level check; does not edit user project files).
    remote = f"""
set +e
cid=$(docker ps -qf name=quickxbuild-web | head -1)
echo CID=$cid
echo BUILD_ID=$(docker exec "$cid" sh -lc 'cat /workspace/apps/web/.next/BUILD_ID')
echo "=== container preview mode string in bundle ==="
docker exec "$cid" sh -lc 'grep -R -l "Preview URL requested" /workspace/apps/web/.next/server 2>/dev/null | head -3'
docker exec "$cid" sh -lc 'grep -R -o "mode===\\"preview\\"|mode === \\"preview\\"|syncMs.*12000|12_000" /workspace/apps/web/.next/server 2>/dev/null | head -10'
echo "=== e2b create sandbox smoke ==="
docker exec "$cid" sh -lc '
  code=$(curl -sS -o /tmp/e2b_create -w "%{{http_code}}" -X POST "https://api.e2b.dev/sandboxes" \\
    -H "X-API-KEY: $E2B_API_KEY" -H "Content-Type: application/json" \\
    -d "{{\\"templateID\\":\\"base\\",\\"timeout\\":60}}" || echo fail)
  echo CREATE_HTTP=$code
  head -c 400 /tmp/e2b_create; echo
  sid=$(python3 -c "import json; d=json.load(open(\\"/tmp/e2b_create\\")); print(d.get(\\"sandboxID\\") or d.get(\\"sandboxId\\") or \\"\\")" 2>/dev/null)
  echo SID=$sid
  if [ -n "$sid" ]; then
    curl -sS -o /tmp/e2b_del -w "DEL=%{{http_code}}\\n" -X DELETE "https://api.e2b.dev/sandboxes/$sid" -H "X-API-KEY: $E2B_API_KEY"
  fi
'
echo "=== looking for project containerId in DB via web env ==="
docker exec "$cid" sh -lc '
  node -e "
    const {{ Client }} = require(\"pg\");
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL;
    if (!url) {{ console.log(\"NO_DB_URL\"); process.exit(0); }}
    const c = new Client({{ connectionString: url, ssl: {{ rejectUnauthorized: false }} }});
    (async () => {{
      await c.connect();
      const r = await c.query(
        \"select id, container_id, \\\\\"organizationId\\\\\" as org, updated_at from project where id = $1 limit 1\",
        [\"{PROJECT_ID}\"]
      );
      console.log(JSON.stringify(r.rows[0] || {{ missing: true }}));
      await c.end();
    }})().catch((e) => {{ console.log(\"DB_ERR\", e.message); process.exit(0); }});
  "
' 2>&1 | tail -20
echo MARKER_PREVIEW_TEST=$(date -u +%Y%m%dT%H%M%SZ)
"""
    _i, out, err = client.exec_command(remote, timeout=180)
    text = (out.read() + err.read()).decode("utf-8", "replace")
    import re

    text = re.sub(r"(e2b_[A-Za-z0-9]+)", "e2b_[REDACTED]", text)
    text = re.sub(r"(eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+)", "JWT_[REDACTED]", text)
    print(text)
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
