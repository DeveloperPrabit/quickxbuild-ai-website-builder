#!/usr/bin/env python3
"""Probe existing project container preview URL via E2B + invoke prepare path markers.
Requires DEPLOY_PASSWORD. Never prints secrets.
"""

from __future__ import annotations

import os
import re
import sys

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

    remote = f"""
set +e
cid=$(docker ps -qf name=quickxbuild-web | head -1)
echo CID=$cid BUILD_ID=$(docker exec "$cid" cat /workspace/apps/web/.next/BUILD_ID)

# Load project container_id
PROJ=$(docker exec -e PID={PROJECT_ID} "$cid" node -e '
const {{Client}}=require("pg");
const url=process.env.DATABASE_URL||process.env.POSTGRES_URL||process.env.NEON_DATABASE_URL;
const c=new Client({{connectionString:url,ssl:{{rejectUnauthorized:false}}}});
(async()=>{{
  await c.connect();
  const r=await c.query("select id, organization_id, container_id from project where id=$1",[process.env.PID]);
  console.log(JSON.stringify(r.rows[0]||null));
  await c.end();
}})().catch(e=>{{console.log("DB_ERR",e.message);}});
')
echo PROJECT=$PROJ
SB=$(echo "$PROJ" | python3 -c "import json,sys; d=json.load(sys.stdin); print((d or {{}}).get('container_id') or '')")
echo CONTAINER_ID=$SB
SANDBOX=$(echo "$SB" | cut -d- -f1)
echo SANDBOX_ID=$SANDBOX

# E2B get sandbox
docker exec "$cid" sh -lc "curl -sS -o /tmp/sb.json -w 'SB_HTTP=%{{http_code}}\\n' -H \\"X-API-KEY: \\$E2B_API_KEY\\" https://api.e2b.dev/sandboxes/$SANDBOX"
docker exec "$cid" head -c 500 /tmp/sb.json; echo

# Common e2b preview host ports for vite: 5173 / 3000
for port in 5173 3000 8080; do
  url="https://$port-$SANDBOX.e2b.app"
  code=$(curl -sS -o /dev/null -w '%{{http_code}}' --max-time 20 -L "$url" || echo fail)
  echo "PROBE $url -> $code"
done

# Also try e2b.dev domain pattern if used
for port in 5173 3000; do
  url="https://$port-$SANDBOX.e2b.dev"
  code=$(curl -sS -o /dev/null -w '%{{http_code}}' --max-time 20 -L "$url" || echo fail)
  echo "PROBE $url -> $code"
done

# Check how getContainerPreviewInfo builds URL in bundle
docker exec "$cid" sh -lc 'grep -oE "e2b\\.(app|dev)|getHost\\(|previewURL|5173" /workspace/apps/web/.next/server/chunks/1082.js | sort | uniq | head -20'

echo PROBE_DONE
"""
    _i, out, err = client.exec_command(remote, timeout=180)
    text = (out.read() + err.read()).decode("utf-8", "replace")
    text = re.sub(r"(e2b_[A-Za-z0-9]+)", "e2b_[REDACTED]", text)
    print(text)
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
