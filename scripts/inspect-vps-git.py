#!/usr/bin/env python3
"""Inspect /opt/quickxbuild git / compose layout. Requires DEPLOY_PASSWORD."""

from __future__ import annotations

import os
import sys

import paramiko

HOST = os.environ.get("DEPLOY_HOST", "64.247.177.39")
PASSWORD = os.environ.get("DEPLOY_PASSWORD", "")
APP_DIR = os.environ.get("DEPLOY_DIR", "/opt/quickxbuild")


def main() -> int:
    if not PASSWORD:
        print("DEPLOY_PASSWORD is required", file=sys.stderr)
        return 1
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", password=PASSWORD, timeout=60)
    cmd = f"""
set -e
echo "PWD=$(pwd)"
ls -la {APP_DIR} | head -40
echo "---"
if [ -d {APP_DIR}/.git ]; then
  echo "HAS_GIT=1"
  cd {APP_DIR}
  git remote -v || true
  git status -sb || true
  git log -1 --oneline || true
else
  echo "HAS_GIT=0"
fi
echo "---"
test -f {APP_DIR}/apps/web/ai/providers.ts && echo HAS_PROVIDERS=1 || echo HAS_PROVIDERS=0
test -f {APP_DIR}/apps/web/.next/BUILD_ID && echo "BUILD_ID=$(cat {APP_DIR}/apps/web/.next/BUILD_ID)" || echo BUILD_ID=missing
docker ps --format 'table {{{{.Names}}}}\\t{{{{.Status}}}}' | head -20
"""
    _stdin, stdout, stderr = client.exec_command(cmd, timeout=120)
    out = (stdout.read() + stderr.read()).decode("utf-8", "replace")
    code = stdout.channel.recv_exit_status()
    client.close()
    print(out)
    print(f"exit={code}")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
