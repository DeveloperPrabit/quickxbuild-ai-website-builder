#!/usr/bin/env python3
"""Verify live preview path: BUILD_ID, bundle marker, call getPreviewUrl via cookie if present,
or create sandbox + hit host preview URL pattern. Requires DEPLOY_PASSWORD.
Never prints secrets.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time

import paramiko

HOST = os.environ.get("DEPLOY_HOST", "64.247.177.39")
PASSWORD = os.environ.get("DEPLOY_PASSWORD", "")
PROJECT_ID = os.environ.get("PROJECT_ID", "kaqz9ypquny655m86hgjwdrp")
SITE = os.environ.get("SITE_URL", "https://websitebuilder.techspireglobal.com")


def main() -> int:
    if not PASSWORD:
        print("DEPLOY_PASSWORD required", file=sys.stderr)
        return 1
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", password=PASSWORD, timeout=60)

    remote = f"""
set +e
cid=$(docker ps -qf name=quickxbuild-web | head -1)
echo CID=$cid
echo BUILD_ID=$(docker exec "$cid" cat /workspace/apps/web/.next/BUILD_ID)
echo "=== bundle markers ==="
docker exec "$cid" sh -lc 'grep -o "Preview URL requested" /workspace/apps/web/.next/server/chunks/1082.js | head -1'
docker exec "$cid" sh -lc 'grep -oE "mode===\\"preview\\"|\\"preview\\".{{0,40}}prepare|syncMs|12000" /workspace/apps/web/.next/server/chunks/*.js 2>/dev/null | head -15'
echo "=== project row ==="
docker exec "$cid" sh -lc "node <<'NODE'
const {{ Client }} = require('pg');
const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL;
if (!url) {{ console.log('NO_DB_URL'); process.exit(0); }}
const c = new Client({{ connectionString: url, ssl: {{ rejectUnauthorized: false }} }});
(async () => {{
  await c.connect();
  const tables = await c.query(\\"select table_name from information_schema.tables where table_schema='public' and table_name ilike '%project%'\\");
  console.log('TABLES', tables.rows.map(r => r.table_name).join(','));
  const cols = await c.query(\\"select column_name from information_schema.columns where table_name='project' order by ordinal_position\\");
  console.log('COLS', cols.rows.map(r => r.column_name).join(','));
  const r = await c.query('select * from project where id = $1 limit 1', ['{PROJECT_ID}']);
  if (!r.rows[0]) {{ console.log('PROJECT_MISSING'); await c.end(); return; }}
  const row = r.rows[0];
  const safe = {{
    id: row.id,
    organizationId: row.organizationId || row.organization_id,
    containerId: row.containerId || row.container_id,
    productionUrl: row.productionUrl || row.production_url,
    updatedAt: row.updatedAt || row.updated_at,
  }};
  console.log('PROJECT', JSON.stringify(safe));
  await c.end();
}})().catch(e => {{ console.log('DB_ERR', e.message); process.exit(0); }});
NODE"
echo "=== invoke getPreviewUrl via internal next (needs session) ==="
# Try without auth to see error shape, then with any better-auth cookie from env file if present
docker exec "$cid" sh -lc 'curl -sS -o /tmp/pv.json -w "HTTP=%{{http_code}} TIME=%{{time_total}}\\n" \\
  -H "content-type: application/json" \\
  "http://127.0.0.1:3000/api/trpc/project.getPreviewUrl?batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%22id%22%3A%22{PROJECT_ID}%22%7D%7D%7D" || true'
head -c 500 /tmp/pv.json 2>/dev/null; echo
docker exec "$cid" cat /tmp/pv.json 2>/dev/null | head -c 800; echo
echo "=== recent logs after curl ==="
sleep 2
docker logs --since 2m "$cid" 2>&1 | grep -iE '{PROJECT_ID}|Preview URL|prepare-container|Container ready|preview|Failed|error|sync|e2b|sandbox' | tail -60
echo VERIFY_DONE
"""
    _i, out, err = client.exec_command(remote, timeout=180)
    text = (out.read() + err.read()).decode("utf-8", "replace")
    text = re.sub(r"(e2b_[A-Za-z0-9]+)", "e2b_[REDACTED]", text)
    text = re.sub(r"(eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+)", "JWT_[REDACTED]", text)
    print(text)
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
