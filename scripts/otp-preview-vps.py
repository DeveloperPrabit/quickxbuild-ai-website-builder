#!/usr/bin/env python3
"""Request email OTP, read code from D1 verification, sign in, call getPreviewUrl.
Requires DEPLOY_PASSWORD.
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
SITE = "https://websitebuilder.techspireglobal.com"

REMOTE = r'''
set -e
cid=$(docker ps -qf name=quickxbuild-web | head -1)
EMAIL='__EMAIL__'
PROJECT_ID='__PROJECT_ID__'
SITE='__SITE__'

echo "=== send OTP ==="
curl -sS -o /tmp/otp1.json -w "HTTP=%{http_code}\n" --max-time 30 \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${EMAIL}\"}" \
  "${SITE}/api/auth/email-otp/send-verification-otp" || true
# try alternate endpoints
curl -sS -o /tmp/otp2.json -w "HTTP=%{http_code}\n" --max-time 30 \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${EMAIL}\",\"type\":\"sign-in\"}" \
  "${SITE}/api/auth/sign-in/email-otp" || true
curl -sS -o /tmp/otp3.json -w "HTTP=%{http_code}\n" --max-time 30 \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${EMAIL}\",\"type\":\"sign-in\"}" \
  "${SITE}/api/auth/email-otp/send-verification-otp" || true
head -c 200 /tmp/otp1.json; echo
head -c 200 /tmp/otp2.json; echo
head -c 200 /tmp/otp3.json; echo

sleep 2
echo "=== verification rows ==="
docker exec -w /workspace/apps/web -e NODE_ENV=development "$cid" \
  bunx wrangler d1 execute quickxbuild --local --json --command \
  "SELECT identifier, value, expires_at FROM verification ORDER BY expires_at DESC LIMIT 5" || true

# Extract OTP-looking values
OTP=$(docker exec -w /workspace/apps/web -e NODE_ENV=development "$cid" \
  bunx wrangler d1 execute quickxbuild --local --json --command \
  "SELECT value FROM verification WHERE identifier LIKE '%${EMAIL}%' OR identifier LIKE '%otp%' ORDER BY expires_at DESC LIMIT 5" \
  | python3 -c "import sys,re; t=sys.stdin.read(); nums=re.findall(r'\"value\"\s*:\s*\"([0-9]{4,8})\"', t); print(nums[0] if nums else '')")
echo "OTP_LEN=${#OTP}"

if [ -n "$OTP" ]; then
  echo "=== sign-in email-otp ==="
  curl -sS -D /tmp/signin.hdr -o /tmp/signin.json -w "HTTP=%{http_code}\n" --max-time 30 \
    -H 'content-type: application/json' \
    -d "{\"email\":\"${EMAIL}\",\"otp\":\"${OTP}\"}" \
    "${SITE}/api/auth/sign-in/email-otp" || true
  head -c 400 /tmp/signin.json; echo
  grep -i 'set-cookie' /tmp/signin.hdr | sed 's/__Secure-better-auth.session_token=[^;]*/__Secure-better-auth.session_token=REDACTED/' || true
  COOKIE=$(python3 - <<'PY'
import re
h=open('/tmp/signin.hdr',encoding='utf-8',errors='replace').read()
# prefer __Secure session token
m=re.search(r'set-cookie:\s*(__Secure-better-auth\.session_token=[^;\s]+)', h, re.I)
if not m:
  m=re.search(r'set-cookie:\s*(better-auth\.session_token=[^;\s]+)', h, re.I)
print(m.group(1) if m else '')
PY
)
  echo "COOKIE_HDR_LEN=${#COOKIE}"
  if [ -n "$COOKIE" ]; then
    INPUT=$(python3 -c "import urllib.parse,json; print(urllib.parse.quote(json.dumps({'0':{'json':{'id':'__PROJECT_ID__'}}})))")
    echo "=== getPreviewUrl ==="
    curl -sS -o /tmp/pv.json -w "HTTP=%{http_code} TIME=%{time_total}\n" --max-time 150 \
      -H "Cookie: ${COOKIE}" \
      "${SITE}/api/trpc/project.getPreviewUrl?batch=1&input=${INPUT}" || true
    head -c 1200 /tmp/pv.json; echo
    python3 - <<'PY'
import re,subprocess
t=open('/tmp/pv.json',encoding='utf-8',errors='replace').read()
m=re.search(r'https://[0-9]+-[a-z0-9]+\.e2b\.(?:app|dev)[^"\\]*', t)
print('EXTRACTED_URL', m.group(0) if m else None)
if m:
  code=subprocess.check_output(['curl','-sS','-o','/dev/null','-w','%{http_code}','--max-time','45','-L',m.group(0)], text=True)
  print('PREVIEW_HTTP', code)
PY
  fi
fi

echo "=== recent logs ==="
docker logs --since 3m "$cid" 2>&1 | grep -iE "${PROJECT_ID}|Preview URL|prepare|Container ready|otp|Failed|e2b" | tail -60 || true
echo OTP_FLOW_DONE
'''


def main() -> int:
    if not PASSWORD:
        print("DEPLOY_PASSWORD required", file=sys.stderr)
        return 1
    script = (
        REMOTE.replace("__EMAIL__", EMAIL)
        .replace("__PROJECT_ID__", PROJECT_ID)
        .replace("__SITE__", SITE)
    )
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", password=PASSWORD, timeout=60)
    sftp = client.open_sftp()
    with sftp.file("/tmp/otp-preview.sh", "w") as f:
        f.write(script)
    sftp.chmod("/tmp/otp-preview.sh", 0o755)
    sftp.close()
    _i, out, err = client.exec_command("bash /tmp/otp-preview.sh", timeout=300)
    text = (out.read() + err.read()).decode("utf-8", "replace")
    text = re.sub(r"(e2b_[A-Za-z0-9]+)", "e2b_[REDACTED]", text)
    text = re.sub(r"(session_token=)[^;\s]+", r"\1REDACTED", text)
    print(text)
    client.close()
    return 0 if "EXTRACTED_URL https" in text else 1


if __name__ == "__main__":
    raise SystemExit(main())
