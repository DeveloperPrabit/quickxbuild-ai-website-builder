#!/usr/bin/env python3
"""Install @octokit/app on VPS and restart web so /api/ai works."""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

import paramiko

HOST = os.environ.get("DEPLOY_HOST", "64.247.177.39")
PASSWORD = os.environ["DEPLOY_PASSWORD"]
ROOT = Path(__file__).resolve().parents[1]


def safe_print(text: str) -> None:
    sys.stdout.write(text.encode("ascii", "replace").decode("ascii"))
    sys.stdout.flush()


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 600) -> str:
    print(f"$ {cmd[:200]}", flush=True)
    _, stdout, _ = client.exec_command(cmd, timeout=timeout, get_pty=True)
    out = stdout.read().decode("utf-8", "replace")
    safe_print(out[-3500:])
    return out


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", password=PASSWORD, timeout=60, banner_timeout=60)
    sftp = client.open_sftp()

    # Sync package.json + lock if present
    for rel in [
        "packages/api/package.json",
        "package.json",
        "bun.lock",
        "packages/templates/vite-shadcn-template.ts",
    ]:
        local = ROOT / rel
        if not local.exists():
            # bun may use bun.lockb
            alt = ROOT / "bun.lockb"
            if rel == "bun.lock" and alt.exists():
                local = alt
                rel = "bun.lockb"
            else:
                print("skip", rel, flush=True)
                continue
        remote = f"/tmp/qx-oct/{rel}"
        run(client, f"mkdir -p '{Path(remote).parent.as_posix()}'")
        sftp.put(str(local), remote)
        container = f"/workspace/{rel}"
        run(client, f"docker exec quickxbuild-web-1 mkdir -p '{Path(container).parent.as_posix()}'")
        run(client, f"docker cp '{remote}' 'quickxbuild-web-1:{container}'")

    run(
        client,
        "docker exec -w /workspace quickxbuild-web-1 bun add @octokit/app@15.1.6 @octokit/rest@22.0.0",
        timeout=300,
    )
    run(client, "docker exec quickxbuild-web-1 rm -rf /workspace/apps/web/.next")
    run(client, "docker restart quickxbuild-web-1")
    time.sleep(25)
    for _ in range(20):
        out = run(client, "curl -m 25 -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/")
        if "200" in out:
            break
        time.sleep(4)

    # Confirm module resolves
    run(
        client,
        "docker exec -w /workspace quickxbuild-web-1 "
        "bun -e \"import('@octokit/app').then(m=>console.log('octokit-app',!!m.App)).catch(e=>console.error(e))\"",
    )
    sftp.close()
    client.close()
    print("OCTOKIT_FIX_DONE", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
