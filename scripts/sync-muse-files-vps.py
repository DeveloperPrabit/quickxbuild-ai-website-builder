#!/usr/bin/env python3
"""
Sync Muse Spark source files to /opt/quickxbuild (tarball deploy tree, no git).
Requires DEPLOY_PASSWORD. Does not upload .env.
"""

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
    "apps/web/ai/providers.ts",
    "apps/web/ai/capabilities.ts",
    "apps/web/ai/models.ts",
    "apps/web/ai/provider-failover.ts",
    "apps/web/configs/ai-models.ts",
    "apps/web/env.mjs",
    "apps/web/ai/__tests__/agent.test.ts",
    "apps/web/ai/__tests__/provider-failover.test.ts",
    ".env.example",
    "scripts/set-muse-env-vps.py",
]


def main() -> int:
    if not PASSWORD:
        print("DEPLOY_PASSWORD is required", file=sys.stderr)
        return 1

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", password=PASSWORD, timeout=60)
    sftp = client.open_sftp()

    for rel in FILES:
        local = ROOT / rel
        if not local.is_file():
            print(f"SKIP missing {rel}")
            continue
        remote = f"{APP_DIR}/{rel}".replace("\\", "/")
        remote_dir = remote.rsplit("/", 1)[0]
        client.exec_command(f"mkdir -p {remote_dir}", timeout=30)[1].channel.recv_exit_status()
        print(f"PUT {rel}")
        sftp.put(str(local), remote)

    # Confirm Muse markers on server (no secrets)
    _i, stdout, stderr = client.exec_command(
        f"grep -n 'MUSE_MODEL_ID\\|isMuseConfigured\\|muse-spark' "
        f"{APP_DIR}/apps/web/ai/providers.ts {APP_DIR}/apps/web/ai/capabilities.ts "
        f"| head -20",
        timeout=60,
    )
    print((stdout.read() + stderr.read()).decode("utf-8", "replace"))
    sftp.close()
    client.close()
    print("sync_ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
