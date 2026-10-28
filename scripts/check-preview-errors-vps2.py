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
docker logs --since 45m "$cid" 2>&1 | grep -iE 'kaqz9ypquny655m86hgjwdrp|Failed to get|preview info|sandbox|e2b|prepareContainer|not found|timeout|TRPC|INTERNAL' | tail -120
echo ---
docker logs --since 45m "$cid" 2>&1 | grep -iE 'error|Error|WARN' | grep -iE 'preview|sandbox|e2b|container|project' | tail -60
"""
    _i, out, err = client.exec_command(remote, timeout=120)
    print((out.read() + err.read()).decode("utf-8", "replace"))
    code = out.channel.recv_exit_status()
    client.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
