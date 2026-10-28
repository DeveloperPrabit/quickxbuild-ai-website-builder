#!/usr/bin/env python3
"""Deploy English-only locale fixes to VPS."""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

import paramiko

HOST = os.environ.get("DEPLOY_HOST", "64.247.177.39")
PASSWORD = os.environ["DEPLOY_PASSWORD"]
ROOT = Path(__file__).resolve().parents[1]

FILES = [
    "apps/web/project.inlang/settings.json",
    "apps/web/next.config.mjs",
    "apps/web/middleware.ts",
    "apps/web/app/(frontend)/layout.tsx",
    "apps/web/components/language-switcher.tsx",
    "apps/web/components/marketing/nav/index.tsx",
    "apps/web/components/dashboard/site-header.tsx",
    "apps/web/messages/en.json",
    "apps/web/messages/zh.json",
    "apps/web/ai/prompts/system-prompt.ts",
    "apps/web/ai/prompts/system-prompt.md",
    "apps/web/ai/prompts/enhanced-system-prompt.ts",
]


def safe_print(text: str) -> None:
    sys.stdout.write(text.encode("ascii", "replace").decode("ascii"))
    sys.stdout.flush()


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 300) -> str:
    print(f"$ {cmd[:200]}", flush=True)
    _, stdout, _ = client.exec_command(cmd, timeout=timeout, get_pty=True)
    out = stdout.read().decode("utf-8", "replace")
    safe_print(out[-3000:])
    return out


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", password=PASSWORD, timeout=60, banner_timeout=60)
    sftp = client.open_sftp()

    for rel in FILES:
        local = ROOT / rel
        if not local.exists():
            print("MISSING", rel, flush=True)
            continue
        remote = f"/tmp/qx-en/{rel}"
        run(client, f"mkdir -p '{Path(remote).parent.as_posix()}'")
        sftp.put(str(local), remote)
        container = f"/workspace/{rel}"
        run(client, f"docker exec quickxbuild-web-1 mkdir -p '{Path(container).parent.as_posix()}'")
        run(client, f"docker cp '{remote}' 'quickxbuild-web-1:{container}'")

    run(
        client,
        "docker exec -w /workspace/apps/web quickxbuild-web-1 "
        "bunx paraglide-js compile --project ./project.inlang --outdir ./paraglide",
        timeout=180,
    )
    # Clear stale zh locale cookies at nginx is hard; app now ignores them.
    run(client, "docker restart quickxbuild-web-1")
    time.sleep(25)
    for _ in range(15):
        out = run(client, "curl -m 20 -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/")
        if "200" in out:
            break
        time.sleep(4)
    run(
        client,
        "curl -m 30 -s -H 'Accept-Language: zh-CN,zh;q=0.9' http://127.0.0.1:3000/login "
        "| tr '\\n' ' ' | grep -oE '.{0,40}(开源|登录|控制台|免费开始|中文).{0,20}' | head -5 || echo 'NO_CHINESE_SNIPPETS'",
    )
    sftp.close()
    client.close()
    print("ENGLISH_ONLY_DONE", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
