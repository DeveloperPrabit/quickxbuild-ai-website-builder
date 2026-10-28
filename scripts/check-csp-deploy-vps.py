#!/usr/bin/env python3
"""Confirm deployed web bundle includes preview CSP helpers. Requires DEPLOY_PASSWORD."""

from __future__ import annotations

import os
import sys

import paramiko

HOST = os.environ.get("DEPLOY_HOST", "64.247.177.39")
PASSWORD = os.environ.get("DEPLOY_PASSWORD", "")

REMOTE = r"""
set +e
cid=$(docker ps -qf name=quickxbuild-web | head -1)
echo CID=$cid
echo BUILD=$(docker exec "$cid" cat /workspace/apps/web/.next/BUILD_ID)
docker exec "$cid" sh -lc 'node -e "console.log(\"E2B=\"+require(\"e2b/package.json\").version)"' 2>/dev/null || echo E2B=missing
echo "=== bundle markers ==="
docker exec "$cid" sh -lc 'grep -R -l "previewEmbedCsp\|Preview iframe CSP" /workspace/apps/web/.next/server 2>/dev/null | head -5'
docker exec "$cid" sh -lc 'grep -R -o "previewEmbedCsp\|Preview iframe CSP\|PREVIEW_FRAME_ANCESTORS" /workspace/apps/web/.next/server 2>/dev/null | head -20'
echo "=== env ==="
docker exec "$cid" sh -lc 'echo NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL; echo PREVIEW_FRAME_ANCESTORS=$PREVIEW_FRAME_ANCESTORS'
echo CHECK_DONE
"""


def main() -> int:
    if not PASSWORD:
        print("DEPLOY_PASSWORD required", file=sys.stderr)
        return 1
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", password=PASSWORD, timeout=60)
    _i, out, err = client.exec_command(REMOTE, timeout=120)
    print((out.read() + err.read()).decode("utf-8", "replace"))
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
