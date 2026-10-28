#!/usr/bin/env python3
"""Sync preview-fix source files to VPS (no git on server). Requires DEPLOY_PASSWORD."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import paramiko

HOST = os.environ.get("DEPLOY_HOST", "64.247.177.39")
PASSWORD = os.environ.get("DEPLOY_PASSWORD", "")
APP_DIR = os.environ.get("DEPLOY_DIR", "/opt/quickxbuild")
ROOT = Path(__file__).resolve().parents[1]

FILES = [
    "packages/api/src/utils/container.ts",
    "packages/api/src/utils/generated-app-db-env.ts",
    "packages/api/src/router/project/container-operations.ts",
    "packages/sandbox/src/providers/e2b-provider.ts",
    "apps/vite-shadcn-template/vite.config.ts",
]


def main() -> int:
    if not PASSWORD:
        print("DEPLOY_PASSWORD required", file=sys.stderr)
        return 1
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", password=PASSWORD, timeout=60)
    sftp = client.open_sftp()
    for rel in FILES:
        local = ROOT / rel
        remote = f"{APP_DIR}/{rel}"
        remote_dir = remote.rsplit("/", 1)[0]
        client.exec_command(f"mkdir -p {remote_dir}", timeout=30)[1].channel.recv_exit_status()
        print(f"PUT {rel}")
        sftp.put(str(local), remote)
    sftp.close()
    # Confirm markers
    _i, out, err = client.exec_command(
        f"grep -n 'mode === .preview.|prepareInflight|placeholder' "
        f"{APP_DIR}/packages/api/src/utils/container.ts | head -15",
        timeout=30,
    )
    print((out.read() + err.read()).decode("utf-8", "replace"))
    client.close()
    print("sync_ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
