#!/usr/bin/env python3
"""Pull origin/main on the QuickXBuild VPS. Requires DEPLOY_PASSWORD."""

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

    cmd = (
        f"cd {APP_DIR} && "
        "git fetch origin main && "
        "git reset --hard origin/main && "
        "git log -1 --oneline && "
        "grep -E '^(MODEL_API_KEY|MODEL_NAME|AI_PROVIDER)=' .env | sed 's/=.*/=<set>/'"
    )
    _stdin, stdout, stderr = client.exec_command(cmd, timeout=180)
    out = (stdout.read() + stderr.read()).decode("utf-8", "replace")
    code = stdout.channel.recv_exit_status()
    client.close()
    print(out.strip())
    print(f"exit={code}")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
