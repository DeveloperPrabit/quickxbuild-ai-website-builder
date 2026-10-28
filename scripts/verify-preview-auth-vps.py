#!/usr/bin/env python3
"""Upload + run a remote verifier: temp D1 session -> getPreviewUrl -> probe URL.
Requires DEPLOY_PASSWORD. Never prints secrets.
"""

from __future__ import annotations

import os
import re
import sys
import time

import paramiko

HOST = os.environ.get("DEPLOY_HOST", "64.247.177.39")
PASSWORD = os.environ.get("DEPLOY_PASSWORD", "")
PROJECT_ID = os.environ.get("PROJECT_ID", "kaqz9ypquny655m86hgjwdrp")
EMAIL = os.environ.get("VERIFY_EMAIL", "prabitjoshi@gmail.com")

REMOTE_SH = r"""#!/bin/bash
set -euo pipefail
PROJECT_ID="__PROJECT_ID__"
EMAIL="__EMAIL__"
TOKEN="__TOKEN__"
SID="__SID__"
cid=$(docker ps -qf name=quickxbuild-web | head -1)
echo "CID=$cid"
echo "BUILD_ID=$(docker exec "$cid" cat /workspace/apps/web/.next/BUILD_ID)"

USER_JSON=$(docker exec -w /workspace/apps/web -e NODE_ENV=development "$cid" \
  bunx wrangler d1 execute quickxbuild --local --json --command \
  "SELECT u.id as user_id, m.organization_id FROM user u JOIN member m ON m.user_id = u.id WHERE u.email = '${EMAIL}' LIMIT 1")
echo "USER_LOOKUP_OK"
USER_ID=$(echo "$USER_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); rows=(d[0]['results'] if isinstance(d,list) else d.get('results',[])); print(rows[0]['user_id'] if rows else '')")
ORG_ID=$(echo "$USER_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); rows=(d[0]['results'] if isinstance(d,list) else d.get('results',[])); print(rows[0]['organization_id'] if rows else '')")
echo "USER_ID_LEN=${#USER_ID} ORG_ID_LEN=${#ORG_ID}"
if [ -z "$USER_ID" ] || [ -z "$ORG_ID" ]; then echo FAIL_NO_USER; exit 2; fi

PROJ=$(docker exec -e PID="$PROJECT_ID" "$cid" node -e '
const {Client}=require("pg");
const url=process.env.DATABASE_URL||process.env.POSTGRES_URL||process.env.NEON_DATABASE_URL;
const c=new Client({connectionString:url,ssl:{rejectUnauthorized:false}});
(async()=>{
  await c.connect();
  const r=await c.query("select id, organization_id, container_id from project where id=$1", [process.env.PID]);
  console.log(JSON.stringify(r.rows[0]||null));
  await c.end();
})().catch(e=>{console.error("DB_ERR", e.message); process.exit(0);});
')
echo "PROJECT=$PROJ"

SAMPLE=$(docker exec -w /workspace/apps/web -e NODE_ENV=development "$cid" \
  bunx wrangler d1 execute quickxbuild --local --json --command \
  "SELECT expires_at, created_at FROM session LIMIT 1" || true)
echo "SAMPLE_SESSION_OK"

NOW=$(date +%s)
EXP_MS=$(( (NOW + 3600) * 1000 ))
NOW_MS=$(( NOW * 1000 ))
# If sample looks like seconds (< 1e12), use seconds
USE_MS=1
SAMPLE_VAL=$(echo "$SAMPLE" | python3 -c "import json,sys,re
t=sys.stdin.read()
m=re.search(r'\"expires_at\"\s*:\s*(\d+)', t)
print(m.group(1) if m else '0')" 2>/dev/null || echo 0)
if [ "$SAMPLE_VAL" != "0" ] && [ "$SAMPLE_VAL" -lt 1000000000000 ]; then
  EXP_MS=$(( NOW + 3600 ))
  NOW_MS=$NOW
  USE_MS=0
fi
echo "TS_MODE_MS=$USE_MS"

docker exec -w /workspace/apps/web -e NODE_ENV=development "$cid" \
  bunx wrangler d1 execute quickxbuild --local --command \
  "DELETE FROM session WHERE id = '${SID}' OR token = '${TOKEN}'" >/dev/null || true

docker exec -w /workspace/apps/web -e NODE_ENV=development "$cid" \
  bunx wrangler d1 execute quickxbuild --local --command \
  "INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id, active_organization_id) VALUES ('${SID}', ${EXP_MS}, '${TOKEN}', ${NOW_MS}, ${NOW_MS}, '${USER_ID}', '${ORG_ID}')"
echo "SESSION_INSERTED"

COOKIE=$(docker exec "$cid" node -e "
const crypto=require('crypto');
const secret=process.env.BETTER_AUTH_SECRET||'';
const token='${TOKEN}';
const hmac=crypto.createHmac('sha256', secret).update(token).digest('base64url');
process.stdout.write(token+'.'+hmac);
")
echo "COOKIE_LEN=${#COOKIE}"

SESS_HTTP=$(docker exec "$cid" sh -lc "curl -sS -o /tmp/sess.json -w '%{http_code}' -H 'Cookie: better-auth.session_token=${COOKIE}' http://127.0.0.1:3000/api/auth/get-session")
echo "SESS_HTTP=$SESS_HTTP"
docker exec "$cid" node -e 'const d=JSON.parse(require("fs").readFileSync("/tmp/sess.json","utf8")); console.log("SESS_HAS_USER", !!(d&&d.user)); console.log("SESS_EMAIL", d&&d.user&&d.user.email);'

INPUT=$(python3 -c "import urllib.parse,json; print(urllib.parse.quote(json.dumps({'0':{'json':{'id':'${PROJECT_ID}'}}})))")
echo "=== getPreviewUrl ==="
START=$(date +%s)
PV_HTTP=$(docker exec "$cid" sh -lc "curl -sS -o /tmp/pv.json -w '%{http_code}' --max-time 150 -H 'Cookie: better-auth.session_token=${COOKIE}' 'http://127.0.0.1:3000/api/trpc/project.getPreviewUrl?batch=1&input=${INPUT}'")
END=$(date +%s)
echo "PV_HTTP=$PV_HTTP ELAPSED=$((END-START))s"
docker exec "$cid" cat /tmp/pv.json | head -c 1500; echo

PV_URL=$(docker exec "$cid" node -e '
try {
  const d=JSON.parse(require("fs").readFileSync("/tmp/pv.json","utf8"));
  const r = Array.isArray(d) ? d[0] : d;
  const url = r?.result?.data?.json?.previewURL || r?.result?.data?.previewURL || "";
  console.log(url);
} catch(e) { console.log(""); }
')
echo "PV_URL=$PV_URL"
if [ -n "$PV_URL" ]; then
  PREVIEW_HTTP=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 45 -L "$PV_URL" || echo fail)
  echo "PREVIEW_HTTP=$PREVIEW_HTTP"
fi

echo "=== logs ==="
docker logs --since 3m "$cid" 2>&1 | grep -iE "${PROJECT_ID}|Preview URL|prepare|Container ready|preview|Failed|error|e2b|sandbox|sync|WARN" | tail -100 || true

docker exec -w /workspace/apps/web -e NODE_ENV=development "$cid" \
  bunx wrangler d1 execute quickxbuild --local --command \
  "DELETE FROM session WHERE id = '${SID}' OR token = '${TOKEN}'" >/dev/null || true
echo "CLEANUP_OK"
echo "VERIFY_AUTH_DONE"
"""


def main() -> int:
    if not PASSWORD:
        print("DEPLOY_PASSWORD required", file=sys.stderr)
        return 1

    token = f"preview_verify_{int(time.time())}"
    sid = f"sess_preview_verify_{int(time.time())}"
    script = (
        REMOTE_SH.replace("__PROJECT_ID__", PROJECT_ID)
        .replace("__EMAIL__", EMAIL)
        .replace("__TOKEN__", token)
        .replace("__SID__", sid)
    )

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", password=PASSWORD, timeout=60)
    sftp = client.open_sftp()
    with sftp.file("/tmp/verify-preview-auth.sh", "w") as f:
        f.write(script)
    sftp.chmod("/tmp/verify-preview-auth.sh", 0o755)
    sftp.close()

    _i, out, err = client.exec_command("bash /tmp/verify-preview-auth.sh", timeout=300)
    text = (out.read() + err.read()).decode("utf-8", "replace")
    text = re.sub(r"(e2b_[A-Za-z0-9]+)", "e2b_[REDACTED]", text)
    text = re.sub(r"(preview_verify_\d+\.[A-Za-z0-9_-]+)", "COOKIE_[REDACTED]", text)
    print(text)
    client.close()

    ok = "PV_HTTP=200" in text and "PV_URL=http" in text
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
