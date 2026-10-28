#!/usr/bin/env python3
"""Verify Muse Spark env inside quickxbuild-web. Requires DEPLOY_PASSWORD. Never prints secrets."""

from __future__ import annotations

import os
import sys

import paramiko

HOST = os.environ.get("DEPLOY_HOST", "64.247.177.39")
PASSWORD = os.environ.get("DEPLOY_PASSWORD", "")


def main() -> int:
    if not PASSWORD:
        print("DEPLOY_PASSWORD is required", file=sys.stderr)
        return 1

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", password=PASSWORD, timeout=60)

    remote = r"""
set -e
cid=$(docker ps -qf name=quickxbuild-web | head -1)
echo "CID=$cid"
docker exec "$cid" sh -lc '
  if [ -n "$MODEL_API_KEY" ]; then echo KEY_PRESENT=yes; echo KEY_LEN=${#MODEL_API_KEY}; else echo KEY_PRESENT=no; fi
  echo MODEL_NAME=$MODEL_NAME
  echo AI_PROVIDER=$AI_PROVIDER
  echo BASE=$MODEL_API_BASE_URL
  code=$(curl -sS -o /tmp/meta_out -w "%{http_code}" -H "Authorization: Bearer $MODEL_API_KEY" "$MODEL_API_BASE_URL/models" || echo fail)
  echo META_HTTP=$code
  head -c 200 /tmp/meta_out 2>/dev/null; echo
'
"""
    _stdin, stdout, stderr = client.exec_command(remote, timeout=90)
    out = (stdout.read() + stderr.read()).decode("utf-8", "replace")
    code = stdout.channel.recv_exit_status()
    client.close()
    print(out.strip())
    print(f"exit={code}")
    return 0 if code == 0 else code


if __name__ == "__main__":
    raise SystemExit(main())
