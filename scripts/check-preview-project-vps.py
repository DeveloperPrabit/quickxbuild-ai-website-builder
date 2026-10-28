#!/usr/bin/env python3
"""Check preview/container status for a project on the VPS. Requires DEPLOY_PASSWORD."""

from __future__ import annotations

import os
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

    # Grep web logs for this project / preview / e2b / sandbox errors (no secrets)
    remote = f"""
set +e
echo "=== web logs (project/preview/e2b) ==="
docker logs --tail 400 $(docker ps -qf name=quickxbuild-web | head -1) 2>&1 \\
  | grep -E '{PROJECT_ID}|preview|e2b|sandbox|E2B|container|Vite|error|Error|failed' \\
  | tail -80
echo "=== env preview-related (names only) ==="
docker exec $(docker ps -qf name=quickxbuild-web | head -1) sh -lc \\
  'env | grep -E "^(E2B_|NEXT_PUBLIC_SANDBOX|SANDBOX|DAYTONA)" | sed "s/=.*/=<set>/"'
echo "=== done ==="
"""
    _i, stdout, stderr = client.exec_command(remote, timeout=120)
    print((stdout.read() + stderr.read()).decode("utf-8", "replace"))
    code = stdout.channel.recv_exit_status()
    client.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
