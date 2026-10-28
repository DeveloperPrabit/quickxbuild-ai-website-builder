#!/usr/bin/env python3
"""Print recent Agent Runtime log lines from the production web container (read-only)."""
from __future__ import annotations

import os
import sys

import paramiko

HOST = os.environ.get("DEPLOY_HOST", "64.247.177.39")
USER = os.environ.get("DEPLOY_USER", "root")
PASSWORD = os.environ.get("DEPLOY_PASSWORD", "")
PATTERN = os.environ.get(
    "LOG_PATTERN",
    "Agent |agent|failed|Error|error|timed out|Cursor|orchestrated|tool pass|XML write",
)
TAIL = os.environ.get("LOG_TAIL", "3000")


def main() -> int:
    if not PASSWORD:
        print("ERROR: set DEPLOY_PASSWORD in the environment", flush=True)
        return 1
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASSWORD, timeout=60)
    context = os.environ.get("LOG_CONTEXT", "0")
    limit = os.environ.get("LOG_LIMIT", "150")
    cmd = (
        f"docker logs --tail {TAIL} $(docker ps -qf name=web | head -1) 2>&1 "
        f"| grep -E -A {context} '{PATTERN}' | tail -n {limit}"
    )
    _, stdout, _ = client.exec_command(cmd, timeout=120)
    out = stdout.read().decode("utf-8", errors="replace")
    sys.stdout.write(out.encode("ascii", "replace").decode("ascii"))
    client.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
