#!/usr/bin/env python3
"""Seed D1 plans + grant enterprise unlimited quota on Neon for an email."""
from __future__ import annotations

import json
import os
import re
import sys
import time
from pathlib import Path

import paramiko

HOST = os.environ.get("DEPLOY_HOST", "64.247.177.39")
PASSWORD = os.environ["DEPLOY_PASSWORD"]
EMAIL = os.environ.get("GRANT_EMAIL", "prabitjoshi@gmail.com")
ROOT = Path(__file__).resolve().parents[1]


def safe_print(text: str) -> None:
    sys.stdout.write(text.encode("ascii", "replace").decode("ascii"))
    sys.stdout.flush()


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 600) -> tuple[int, str]:
    print(f"$ {cmd[:180]}", flush=True)
    _, stdout, _ = client.exec_command(cmd, timeout=timeout, get_pty=True)
    ch = stdout.channel
    buf: list[str] = []
    while True:
        if ch.recv_ready():
            chunk = ch.recv(8192).decode("utf-8", "replace")
            safe_print(chunk)
            buf.append(chunk)
        if ch.exit_status_ready() and not ch.recv_ready():
            break
        time.sleep(0.05)
    code = ch.recv_exit_status()
    print(f"\nexit {code}", flush=True)
    return code, "".join(buf)


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", password=PASSWORD, timeout=60, banner_timeout=60)
    sftp = client.open_sftp()

    # 1) Seed plans into D1
    sftp.put(str(ROOT / "deploy" / "seed-plans-d1.sql"), "/tmp/seed-plans-d1.sql")
    run(client, "docker cp /tmp/seed-plans-d1.sql quickxbuild-web-1:/tmp/seed-plans-d1.sql")
    run(
        client,
        "docker exec -w /workspace/apps/web -e NODE_ENV=development quickxbuild-web-1 "
        "bunx wrangler d1 execute quickxbuild --local --file=/tmp/seed-plans-d1.sql",
    )

    # 2) Resolve org id from D1
    _, out = run(
        client,
        "docker exec -w /workspace/apps/web -e NODE_ENV=development quickxbuild-web-1 "
        "bunx wrangler d1 execute quickxbuild --local --json --command="
        f"\"SELECT m.organization_id FROM user u JOIN member m ON m.user_id = u.id "
        f"WHERE u.email = '{EMAIL}' LIMIT 1\"",
    )
    org_id = None
    m = re.search(r'"organization_id"\s*:\s*"([^"]+)"', out)
    if m:
        org_id = m.group(1)
    if not org_id:
        print("ERROR: org not found for", EMAIL, flush=True)
        client.close()
        return 1
    print("ORG", org_id, flush=True)

    # D1 subscription badge (sidebar reads this)
    sub_id = f"sub_enterprise_{org_id[:8]}"
    now_ts = int(time.time())
    end_ts = now_ts + 365 * 24 * 60 * 60
    run(
        client,
        "docker exec -w /workspace/apps/web -e NODE_ENV=development quickxbuild-web-1 "
        "bunx wrangler d1 execute quickxbuild --local --command="
        f"\"DELETE FROM subscription WHERE reference_id = '{org_id}'\"",
    )
    run(
        client,
        "docker exec -w /workspace/apps/web -e NODE_ENV=development quickxbuild-web-1 "
        "bunx wrangler d1 execute quickxbuild --local --command="
        f"\"INSERT INTO subscription (id, plan, reference_id, status, period_start, period_end, seats, cancel_at_period_end) "
        f"VALUES ('{sub_id}', 'quickxbuild enterprise', '{org_id}', 'active', {now_ts}, {end_ts}, 99999, 0)\"",
    )

    # 3) Grant script on Neon
    grant_js = f"""
import {{ createId }} from '@paralleldrive/cuid2'
import pg from 'pg'

const orgId = process.env.GRANT_ORG_ID
const url = process.env.POSTGRES_URL
const client = new pg.Client({{ connectionString: url, ssl: {{ rejectUnauthorized: false }} }})
await client.connect()
const now = new Date()
const periodEnd = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)
await client.query(
  `UPDATE subscription_limit SET is_active = false, updated_at = NOW()
   WHERE organization_id = $1 AND is_active = true`,
  [orgId]
)
await client.query(
  `INSERT INTO subscription_limit (
     id, organization_id, stripe_customer_id, plan_name, plan_id,
     ai_nums, enhance_nums, upload_limit, deploy_limit, seats, project_nums,
     is_active, period_start, period_end, billing_interval, created_at, updated_at
   ) VALUES ($1,$2,NULL,'quickxbuild enterprise','plan_enterprise',99999,99999,99999,99999,99999,99999,true,$3,$4,'year',NOW(),NOW())`,
  [createId(), orgId, now.toISOString(), periodEnd.toISOString()]
)
await client.query(
  `INSERT INTO workspace_billing (
     organization_id, credits_balance, subscription_tier, workspace_type,
     stripe_customer_id, version, created_at, updated_at
   ) VALUES ($1, 999999, 'ADVANCED', 'TEAM', NULL, 1, NOW(), NOW())
   ON CONFLICT (organization_id) DO UPDATE SET
     credits_balance = 999999,
     subscription_tier = 'ADVANCED',
     workspace_type = 'TEAM',
     version = workspace_billing.version + 1,
     updated_at = NOW()`,
  [orgId]
)
console.log(JSON.stringify({{ ok: true, orgId, plan: 'quickxbuild enterprise', ai: 99999, projects: 99999, seats: 99999 }}))
await client.end()
"""
    local_grant = ROOT / "tmp-grant-enterprise.mjs"
    local_grant.write_text(grant_js, encoding="utf-8")
    sftp.put(str(local_grant), "/tmp/grant-enterprise.mjs")
    run(client, "docker cp /tmp/grant-enterprise.mjs quickxbuild-web-1:/workspace/packages/db/grant-enterprise.mjs")
    run(
        client,
        "docker exec -e GRANT_ORG_ID="
        + org_id
        + " -e POSTGRES_URL=\"$(grep -E '^POSTGRES_URL=' /opt/quickxbuild/.env | tr -d '\\r' | cut -d= -f2-)\" "
        "-w /workspace/packages/db quickxbuild-web-1 bun ./grant-enterprise.mjs",
    )

    # 4) Hot-copy patched sources into the running image and restart
    patches = [
        "packages/auth/utils/subscription-limits/types.ts",
        "packages/auth/utils/subscription-limits/utils.ts",
        "packages/auth/utils/subscription-limits.ts",
        "packages/auth/plugins/organization-plugin.ts",
        "packages/db/utils/workspace-billing.ts",
        "packages/api/src/utils/stripe-utils.ts",
        "packages/api/src/utils/membership-validation.ts",
        "packages/api/src/router/stripe.ts",
        "apps/web/components/marketing/price/components/pricing-content.tsx",
        "apps/web/components/marketing/price/utils/plan-display.ts",
        "apps/web/components/dashboard/app-sidebar.tsx",
        "deploy/seed-plans-d1.sql",
    ]
    for rel in patches:
        local = ROOT / rel
        if not local.exists():
            continue
        remote = f"/tmp/qx-patch/{rel}"
        run(client, f"mkdir -p $(dirname {remote})")
        sftp.put(str(local), remote)
        run(client, f"docker cp {remote} quickxbuild-web-1:/workspace/{rel}")

    sftp.close()
    run(client, "docker restart quickxbuild-web-1")
    time.sleep(20)
    for i in range(20):
        _, out = run(client, "curl -m 20 -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/")
        if "200" in out:
            break
        time.sleep(5)
    run(
        client,
        "curl -m 30 -sk -o /dev/null -w 'plans=%{http_code}\\n' "
        "https://websitebuilder.techspireglobal.com/api/trpc/stripe.getUserPlans",
    )
    client.close()
    try:
        local_grant.unlink()
    except OSError:
        pass
    print("DONE", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
