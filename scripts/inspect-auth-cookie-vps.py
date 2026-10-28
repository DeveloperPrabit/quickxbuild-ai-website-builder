#!/usr/bin/env python3
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
cid=$(docker ps -qf name=quickxbuild-web | head -1)
echo CID=$cid
docker exec "$cid" sh -lc 'env | grep -E "BETTER_AUTH|AUTH_|COOKIE|NODE_ENV" | sed "s/=.*/=<set>/"'
echo === d1 path ===
docker exec "$cid" sh -lc 'ls -la /workspace/apps/web/.wrangler/state/v3/d1 2>/dev/null | head -20'
echo === session count ===
docker exec -w /workspace/apps/web -e NODE_ENV=development "$cid" bunx wrangler d1 execute quickxbuild --local --json --command "SELECT count(*) as n FROM session"
echo === recent sessions ===
docker exec -w /workspace/apps/web -e NODE_ENV=development "$cid" bunx wrangler d1 execute quickxbuild --local --json --command "SELECT id, substr(token,1,12) as tok, expires_at, user_id, active_organization_id FROM session ORDER BY created_at DESC LIMIT 3"
echo === cookie probe unsigned ===
# try get-session with an existing session token from DB (unsigned, then signed)
docker exec -w /workspace/apps/web -e NODE_ENV=development "$cid" bunx wrangler d1 execute quickxbuild --local --json --command "SELECT token, expires_at FROM session ORDER BY created_at DESC LIMIT 1" > /tmp/tok.json
python3 - <<'PY'
import json,subprocess,os
raw=open('/tmp/tok.json').read()
# wrangler may wrap; find token
import re
m=re.search(r'"token"\s*:\s*"([^"]+)"', raw)
exp=re.search(r'"expires_at"\s*:\s*(\d+)', raw)
print('FOUND_TOKEN', bool(m), 'EXP', exp.group(1) if exp else None)
if not m:
  raise SystemExit(0)
token=m.group(1)
cid=subprocess.check_output("docker ps -qf name=quickxbuild-web | head -1", shell=True, text=True).strip()
# sign inside container
cookie=subprocess.check_output([
  'docker','exec',cid,'node','-e',
  f"const crypto=require('crypto');const s=process.env.BETTER_AUTH_SECRET||'';const t={token!r};process.stdout.write(t+'.'+crypto.createHmac('sha256',s).update(t).digest('base64url'));"
], text=True)
print('COOKIE_LEN', len(cookie))
for name in ['better-auth.session_token','__Secure-better-auth.session_token','__Host-better-auth.session_token']:
  out=subprocess.check_output([
    'docker','exec',cid,'sh','-lc',
    f"curl -sS -o /tmp/s.json -w '%{{http_code}}' -H 'Cookie: {name}={cookie}' http://127.0.0.1:3000/api/auth/get-session"
  ], text=True)
  body=subprocess.check_output(['docker','exec',cid,'cat','/tmp/s.json'], text=True)[:200]
  print(name, 'HTTP', out, 'BODY', body.replace('\\n',' ')[:180])
PY
"""
    _i, out, err = client.exec_command(remote, timeout=180)
    print((out.read() + err.read()).decode("utf-8", "replace"))
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
