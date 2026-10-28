#!/usr/bin/env python3
"""Call getPreviewUrl over public HTTPS with signed cookie + Bearer.
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
SITE = "https://websitebuilder.techspireglobal.com"

REMOTE = r"""
set -e
cid=$(docker ps -qf name=quickxbuild-web | head -1)
PROJECT_ID='__PROJECT_ID__'
SITE='__SITE__'

TOK_JSON=$(docker exec -w /workspace/apps/web -e NODE_ENV=development "$cid" \
  bunx wrangler d1 execute quickxbuild --local --json --command \
  "SELECT token FROM session WHERE active_organization_id = 'it7bqot2fuzidybro6jr990q' ORDER BY created_at DESC LIMIT 1")
TOKEN=$(echo "$TOK_JSON" | python3 -c "import sys,re; t=sys.stdin.read(); m=re.search(r'\"token\"\s*:\s*\"([^\"]+)\"', t); print(m.group(1) if m else '')")
echo "TOKEN_LEN=${#TOKEN}"
test -n "$TOKEN"

COOKIE=$(docker exec "$cid" node -e 'const crypto=require("crypto"); const s=process.env.BETTER_AUTH_SECRET||""; const t=process.argv[1]; process.stdout.write(t+"."+crypto.createHmac("sha256",s).update(t).digest("base64url"));' "$TOKEN")
echo "COOKIE_LEN=${#COOKIE}"

INPUT=$(P="$PROJECT_ID" python3 -c "import urllib.parse,json,os; print(urllib.parse.quote(json.dumps({'0':{'json':{'id':os.environ['P']}}})))")

echo "=== HTTPS __Secure cookie ==="
curl -sS -o /tmp/pv1.json -w "HTTP=%{http_code} TIME=%{time_total}\n" --max-time 150 \
  -H "Cookie: __Secure-better-auth.session_token=${COOKIE}" \
  "${SITE}/api/trpc/project.getPreviewUrl?batch=1&input=${INPUT}" || true
head -c 900 /tmp/pv1.json; echo

echo "=== HTTPS better-auth cookie ==="
curl -sS -o /tmp/pv1b.json -w "HTTP=%{http_code} TIME=%{time_total}\n" --max-time 150 \
  -H "Cookie: better-auth.session_token=${COOKIE}" \
  "${SITE}/api/trpc/project.getPreviewUrl?batch=1&input=${INPUT}" || true
head -c 400 /tmp/pv1b.json; echo

echo "=== HTTPS Bearer ==="
curl -sS -o /tmp/pv2.json -w "HTTP=%{http_code} TIME=%{time_total}\n" --max-time 150 \
  -H "Authorization: Bearer ${TOKEN}" \
  "${SITE}/api/trpc/project.getPreviewUrl?batch=1&input=${INPUT}" || true
head -c 900 /tmp/pv2.json; echo

echo "=== get-session HTTPS ==="
curl -sS -o /tmp/sess.json -w "HTTP=%{http_code}\n" --max-time 30 \
  -H "Cookie: __Secure-better-auth.session_token=${COOKIE}" \
  "${SITE}/api/auth/get-session" || true
head -c 300 /tmp/sess.json; echo

python3 - <<'PY'
import re
for p in ['/tmp/pv1.json','/tmp/pv1b.json','/tmp/pv2.json']:
  try:
    t=open(p,encoding='utf-8').read()
  except Exception as e:
    print(p, e); continue
  m=re.search(r'https://[0-9]+-[a-z0-9]+\.e2b\.(app|dev)[^"\\]*', t)
  print(p, 'url=', m.group(0) if m else None, 'err=', 'UNAUTHORIZED' in t or 'error' in t[:80])
  if m:
    import subprocess
    code=subprocess.check_output(['curl','-sS','-o','/dev/null','-w','%{http_code}','--max-time','40','-L',m.group(0)], text=True)
    print('PREVIEW_HTTP', code)
PY

echo "=== logs ==="
docker logs --since 3m "$cid" 2>&1 | grep -iE "${PROJECT_ID}|Preview URL|prepare|Container ready|Failed|error|e2b|UNAUTHORIZED" | tail -80 || true
echo DONE
"""


def main() -> int:
    if not PASSWORD:
        print("DEPLOY_PASSWORD required", file=sys.stderr)
        return 1
    script = REMOTE.replace("__PROJECT_ID__", PROJECT_ID).replace("__SITE__", SITE)
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", password=PASSWORD, timeout=60)
    sftp = client.open_sftp()
    with sftp.file("/tmp/call-preview-https.sh", "w") as f:
        f.write(script)
    sftp.chmod("/tmp/call-preview-https.sh", 0o755)
    sftp.close()
    _i, out, err = client.exec_command("bash /tmp/call-preview-https.sh", timeout=300)
    text = (out.read() + err.read()).decode("utf-8", "replace")
    text = re.sub(r"(e2b_[A-Za-z0-9]+)", "e2b_[REDACTED]", text)
    text = re.sub(r"([A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{10,})", "COOKIE_[REDACTED]", text)
    print(text)
    client.close()
    return 0 if ("PREVIEW_HTTP" in text and "url= https" in text.replace("url=", "url= ")) or "previewURL" in text else 1


if __name__ == "__main__":
    raise SystemExit(main())
