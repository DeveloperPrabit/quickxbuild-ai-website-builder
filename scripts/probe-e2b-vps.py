#!/usr/bin/env python3
"""Probe E2B API from the web container. Requires DEPLOY_PASSWORD. Never prints secrets."""

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
docker exec "$cid" sh -lc '
  echo E2B_KEY_LEN=${#E2B_API_KEY}
  echo PROVIDER=$NEXT_PUBLIC_SANDBOX_DEFAULT_PROVIDER
  code=$(curl -sS -o /tmp/e2b_out -w "%{http_code}" -H "X-API-KEY: $E2B_API_KEY" "https://api.e2b.dev/sandboxes?limit=5" || echo fail)
  echo E2B_HTTP=$code
  head -c 300 /tmp/e2b_out; echo
'
"""
    _i, out, err = client.exec_command(remote, timeout=90)
    print((out.read() + err.read()).decode("utf-8", "replace"))
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
