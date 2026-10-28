#!/usr/bin/env python3
"""Hot-patch pricing/contact/opensource fixes + reseed D1 plans on VPS."""
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
    "apps/web/components/marketing/price/utils/plan-display.ts",
    "apps/web/components/marketing/price/utils/plan-utils.tsx",
    "apps/web/components/marketing/price/components/pricing-content.tsx",
    "apps/web/components/marketing/hero/app-description-form.tsx",
    "apps/web/components/auth/FeatureShowcase.tsx",
    "apps/web/components/marketing/contact/contact-form.tsx",
    "apps/web/app/(frontend)/(marketing)/contact/page.tsx",
    "apps/web/app/api/contact/route.ts",
    "apps/web/messages/en.json",
    "apps/web/messages/zh.json",
    "packages/api/src/utils/stripe-utils.ts",
    "deploy/seed-plans-d1.sql",
]


def safe_print(text: str) -> None:
    sys.stdout.write(text.encode("ascii", "replace").decode("ascii"))
    sys.stdout.flush()


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 300) -> str:
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

    for rel in FILES:
        local = ROOT / rel
        if not local.exists():
            print("MISSING", rel, flush=True)
            continue
        remote = f"/tmp/qx-patch/{rel}"
        run(client, f"mkdir -p '{Path(remote).parent.as_posix()}'")
        sftp.put(str(local), remote)
        container_path = f"/workspace/{rel}"
        run(client, f"docker exec quickxbuild-web-1 mkdir -p '{Path(container_path).parent.as_posix()}'")
        run(client, f"docker cp '{remote}' 'quickxbuild-web-1:{container_path}'")

    sftp.put(str(ROOT / "deploy" / "seed-plans-d1.sql"), "/tmp/seed-plans-d1.sql")
    run(client, "docker cp /tmp/seed-plans-d1.sql quickxbuild-web-1:/tmp/seed-plans-d1.sql")
    run(
        client,
        "docker exec -w /workspace/apps/web -e NODE_ENV=development quickxbuild-web-1 "
        "bunx wrangler d1 execute quickxbuild --local --file=/tmp/seed-plans-d1.sql",
    )

    # Ensure CONTACT_TO_EMAIL on host .env and container env via compose recreate note
    run(
        client,
        "grep -q '^CONTACT_TO_EMAIL=' /opt/quickxbuild/.env || "
        "echo 'CONTACT_TO_EMAIL=prabitjoshi@gmail.com' >> /opt/quickxbuild/.env",
    )
    run(
        client,
        "docker exec quickxbuild-web-1 sh -c "
        "\"grep -q '^CONTACT_TO_EMAIL=' /workspace/.env || "
        "echo 'CONTACT_TO_EMAIL=prabitjoshi@gmail.com' >> /workspace/.env\"",
    )

    # Recompile paraglide messages after en/zh edits
    run(
        client,
        "docker exec -w /workspace/apps/web quickxbuild-web-1 "
        "bunx paraglide-js compile --project ./project.inlang --outdir ./paraglide",
        timeout=180,
    )

    run(client, "docker restart quickxbuild-web-1")
    time.sleep(25)
    for _ in range(15):
        out = run(client, "curl -m 20 -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/")
        if "200" in out:
            break
        time.sleep(4)

    run(client, "curl -m 45 -s 'http://127.0.0.1:3000/api/trpc/stripe.getUserPlans' | head -c 1200")
    run(
        client,
        "curl -m 30 -s -o /dev/null -w 'contact=%{http_code}\\n' http://127.0.0.1:3000/contact",
    )
    sftp.close()
    client.close()
    print("PATCH_DONE", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
