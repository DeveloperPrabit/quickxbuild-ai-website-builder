#!/usr/bin/env python3
"""Live debug preview URL path for a project. Requires DEPLOY_PASSWORD."""

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
echo CID=$cid
echo BUILD_ID=$(docker exec "$cid" sh -lc 'cat /workspace/apps/web/.next/BUILD_ID 2>/dev/null || echo missing')
echo "=== last 8 min logs ==="
docker logs --since 8m "$cid" 2>&1 | grep -iE '{PROJECT_ID}|prepare-container|preview|sandbox|e2b|Failed|sync|Container ready|dependency|TRPC|error|Error|WARN' | tail -120
echo "=== e2b sandboxes ==="
docker exec "$cid" sh -lc 'curl -sS -H "X-API-KEY: $E2B_API_KEY" "https://api.e2b.dev/sandboxes?limit=10"' | head -c 1200; echo
"""
    _i, out, err = client.exec_command(remote, timeout=120)
    text = (out.read() + err.read()).decode("utf-8", "replace")
    import re
    text = re.sub(r"(e2b_[A-Za-z0-9]+)", "e2b_[REDACTED]", text)
    text = re.sub(r"(LLM_[A-Za-z0-9_]+)", "LLM_[REDACTED]", text)
    print(text)
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
