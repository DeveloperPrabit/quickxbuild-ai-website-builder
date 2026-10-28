#!/usr/bin/env python3
"""Sign session cookie with @better-auth/utils (base64urlnopad) and call getPreviewUrl.
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

TOK_JSON=$(docker exec -w /workspace/apps/web -e NODE_ENV=development "$cid" \
  bunx wrangler d1 execute quickxbuild --local --json --command \
  "SELECT token FROM session WHERE active_organization_id = 'it7bqot2fuzidybro6jr990q' ORDER BY created_at DESC LIMIT 1")
TOKEN=$(echo "$TOK_JSON" | python3 -c "import sys,re; t=sys.stdin.read(); m=re.search(r'\"token\"\s*:\s*\"([^\"]+)\"', t); print(m.group(1) if m else '')")
echo "TOKEN_LEN=${#TOKEN}"
test -n "$TOKEN"

# Sign with better-auth util (same as production)
COOKIE=$(docker exec -e NODE_PATH=/workspace/node_modules -w /workspace "$cid" node --input-type=module -e '
import { createHMAC } from "@better-auth/utils/hmac";
const secret = process.env.BETTER_AUTH_SECRET || "";
const token = process.argv[1];
const sig = await createHMAC("SHA-256", "base64urlnopad").sign(secret, token);
process.stdout.write(token + "." + sig);
' "$TOKEN")
echo "COOKIE_LEN=${#COOKIE}"

INPUT=$(python3 -c "import urllib.parse,json; print(urllib.parse.quote(json.dumps({'0':{'json':{'id':'__PROJECT_ID__'}}})))")

echo "=== get-session ==="
curl -sS -o /tmp/sess.json -w "HTTP=%{http_code}\n" --max-time 30 \
  -H "Cookie: __Secure-better-auth.session_token=${COOKIE}" \
  "${SITE}/api/auth/get-session" || true
head -c 250 /tmp/sess.json; echo

echo "=== getPreviewUrl (may take up to 2m) ==="
curl -sS -o /tmp/pv.json -w "HTTP=%{http_code} TIME=%{time_total}\n" --max-time 150 \
  -H "Cookie: __Secure-better-auth.session_token=${COOKIE}" \
  "${SITE}/api/trpc/project.getPreviewUrl?batch=1&input=${INPUT}" || true
head -c 1200 /tmp/pv.json; echo

python3 - <<'PY'
import re, subprocess
t=open('/tmp/pv.json',encoding='utf-8',errors='replace').read()
m=re.search(r'https://[0-9]+-[a-z0-9]+\.e2b\.(?:app|dev)[^"\\]*', t)
print('EXTRACTED_URL', m.group(0) if m else None)
if m:
  code=subprocess.check_output(['curl','-sS','-o','/dev/null','-w','%{http_code}','--max-time','40','-L',m.group(0)], text=True)
  print('PREVIEW_HTTP', code)
PY

echo "=== logs ==="
docker logs --since 3m "$cid" 2>&1 | grep -iE "${PROJECT_ID}|Preview URL|prepare|Container ready|Failed|error|e2b|sync" | tail -80 || true
echo DONE
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
    with sftp.file("/tmp/call-preview-signed.sh", "w") as f:
        f.write(script)
    sftp.chmod("/tmp/call-preview-signed.sh", 0o755)
    sftp.close()
    _i, out, err = client.exec_command("bash /tmp/call-preview-signed.sh", timeout=300)
    text = (out.read() + err.read()).decode("utf-8", "replace")
    text = re.sub(r"(e2b_[A-Za-z0-9]+)", "e2b_[REDACTED]", text)
    text = re.sub(r"([A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{10,})", "COOKIE_[REDACTED]", text)
    print(text)
    client.close()
    return 0 if "EXTRACTED_URL https" in text or "previewURL" in text else 1


if __name__ == "__main__":
    raise SystemExit(main())
