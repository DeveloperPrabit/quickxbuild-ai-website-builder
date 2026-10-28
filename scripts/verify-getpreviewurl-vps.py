#!/usr/bin/env python3
"""Sign cookie via better-call (btoa HMAC + encodeURIComponent), call getPreviewUrl, probe.
Requires DEPLOY_PASSWORD.
"""

from __future__ import annotations

import os
import re
import sys

import paramiko

HOST = os.environ.get("DEPLOY_HOST", "64.247.177.39")
PASSWORD = os.environ.get("DEPLOY_PASSWORD", "")
PROJECT_ID = os.environ.get("PROJECT_ID", "kaqz9ypquny655m86hgjwdrp")
SITE = "https://websitebuilder.techspireglobal.com"

REMOTE = r'''
set -e
cid=$(docker ps -qf name=quickxbuild-web | head -1)
PROJECT_ID='__PROJECT_ID__'
SITE='__SITE__'
echo BUILD_ID=$(docker exec "$cid" cat /workspace/apps/web/.next/BUILD_ID)

TOK_JSON=$(docker exec -w /workspace/apps/web -e NODE_ENV=development "$cid" \
  bunx wrangler d1 execute quickxbuild --local --json --command \
  "SELECT token FROM session WHERE active_organization_id = 'it7bqot2fuzidybro6jr990q' ORDER BY created_at DESC LIMIT 1")
TOKEN=$(echo "$TOK_JSON" | python3 -c "import sys,re; t=sys.stdin.read(); m=re.search(r'\"token\"\s*:\s*\"([^\"]+)\"', t); print(m.group(1) if m else '')")
echo TOKEN_LEN=${#TOKEN}
test -n "$TOKEN"

# Sign using better-call's signCookieValue semantics inside container
COOKIE_VAL=$(docker exec -e NODE_PATH=/workspace/node_modules -w /workspace "$cid" node --input-type=module -e '
import { createRequire } from "module";
const require = createRequire(import.meta.url);
// Inline better-call algorithm
const secret = process.env.BETTER_AUTH_SECRET || "";
const value = process.argv[1];
const enc = new TextEncoder();
const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(value));
const b64 = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));
process.stdout.write(encodeURIComponent(value + "." + b64));
' "$TOKEN")
echo COOKIE_VAL_LEN=${#COOKIE_VAL}

echo "=== get-session ==="
curl -sS -o /tmp/sess.json -w "HTTP=%{http_code}\n" --max-time 30 \
  -H "Cookie: __Secure-better-auth.session_token=${COOKIE_VAL}" \
  "${SITE}/api/auth/get-session" || true
python3 -c "import json; d=json.load(open('/tmp/sess.json')); print('HAS_USER', bool(d and d.get('user'))); print('EMAIL', (d or {}).get('user',{}).get('email')); print('ORG', ((d or {}).get('session') or {}).get('activeOrganizationId','')[:12])" 2>/dev/null || head -c 200 /tmp/sess.json; echo

INPUT=$(python3 -c "import urllib.parse,json; print(urllib.parse.quote(json.dumps({'0':{'json':{'id':'__PROJECT_ID__'}}})))")
echo "=== getPreviewUrl ==="
curl -sS -o /tmp/pv.json -w "HTTP=%{http_code} TIME=%{time_total}\n" --max-time 150 \
  -H "Cookie: __Secure-better-auth.session_token=${COOKIE_VAL}" \
  "${SITE}/api/trpc/project.getPreviewUrl?batch=1&input=${INPUT}" || true
head -c 1200 /tmp/pv.json; echo

python3 - <<'PY'
import re, subprocess, json
t=open('/tmp/pv.json',encoding='utf-8',errors='replace').read()
m=re.search(r'https://[^"\\]+e2b\.(?:app|dev)[^"\\]*', t)
print('EXTRACTED_URL', m.group(0) if m else None)
if m:
  code=subprocess.check_output(['curl','-sS','-o','/dev/null','-w','%{http_code}','--max-time','40','-L',m.group(0)], text=True)
  print('PREVIEW_HTTP', code)
PY

echo "=== logs ==="
docker logs --since 3m "$cid" 2>&1 | grep -iE "${PROJECT_ID}|Preview URL|prepare|Container ready|sync|Failed|e2b|error" | tail -80 || true
echo VERIFY_DONE
'''


def main() -> int:
    if not PASSWORD:
        print("DEPLOY_PASSWORD required", file=sys.stderr)
        return 1
    script = REMOTE.replace("__PROJECT_ID__", PROJECT_ID).replace("__SITE__", SITE)
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", password=PASSWORD, timeout=60)
    sftp = client.open_sftp()
    with sftp.file("/tmp/verify-getpreviewurl.sh", "w") as f:
        f.write(script)
    sftp.chmod("/tmp/verify-getpreviewurl.sh", 0o755)
    sftp.close()
    _i, out, err = client.exec_command("bash /tmp/verify-getpreviewurl.sh", timeout=300)
    text = (out.read() + err.read()).decode("utf-8", "replace")
    text = re.sub(r"(e2b_[A-Za-z0-9]+)", "e2b_[REDACTED]", text)
    text = re.sub(r"(__Secure-better-auth\.session_token=)[^;\s]+", r"\1REDACTED", text)
    print(text)
    client.close()
    return 0 if ("HAS_USER True" in text or "EXTRACTED_URL https" in text) else 1


if __name__ == "__main__":
    raise SystemExit(main())
