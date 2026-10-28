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
# Last 250 lines raw around recent activity
docker logs --since 60m "$cid" 2>&1 | tail -250
"""
    _i, out, err = client.exec_command(remote, timeout=120)
    text = (out.read() + err.read()).decode("utf-8", "replace")
    # Redact likely secrets
    import re
    text = re.sub(r"(LLM_[A-Za-z0-9_]+)", "LLM_[REDACTED]", text)
    text = re.sub(r"(e2b_[A-Za-z0-9_]+)", "e2b_[REDACTED]", text)
    text = re.sub(r"(sk-[A-Za-z0-9_-]+)", "sk-[REDACTED]", text)
    print(text)
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
