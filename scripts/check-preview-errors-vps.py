#!/usr/bin/env python3
"""Tail VPS web logs for preview URL failures. Requires DEPLOY_PASSWORD."""

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
    remote = f"""
set +e
cid=$(docker ps -qf name=quickxbuild-web | head -1)
echo "CID=$cid"
echo "=== recent preview/container/e2b errors ==="
docker logs --tail 800 "$cid" 2>&1 | grep -iE 'preview|container|e2b|sandbox|getPreview|Failed to get|{PROJECT_ID}|TRPCError|E2B_' | tail -100
echo "=== e2b env present? ==="
docker exec "$cid" sh -lc 'env | grep -E "^(E2B_|NEXT_PUBLIC_SANDBOX|DAYTONA)" | sed "s/=.*/=<set>/"'
"""
    _i, out, err = client.exec_command(remote, timeout=120)
    print((out.read() + err.read()).decode("utf-8", "replace"))
    code = out.channel.recv_exit_status()
    client.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
