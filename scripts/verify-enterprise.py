#!/usr/bin/env python3
"""Warm Next.js routes and confirm enterprise quota on the VPS."""
from __future__ import annotations

import os
import sys
import time

import paramiko

HOST = os.environ.get("DEPLOY_HOST", "64.247.177.39")
PASSWORD = os.environ["DEPLOY_PASSWORD"]


def safe_print(text: str) -> None:
    sys.stdout.write(text.encode("ascii", "replace").decode("ascii"))
    sys.stdout.flush()


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 180) -> str:
    print(f"$ {cmd[:200]}", flush=True)
    _, stdout, _ = client.exec_command(cmd, timeout=timeout, get_pty=True)
    out = stdout.read().decode("utf-8", "replace")
    safe_print(out[-4000:])
    return out


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", password=PASSWORD, timeout=60, banner_timeout=60)

    # Write verify script into packages/db so deps resolve
    verify = r"""
import pg from 'pg'
const url = process.env.POSTGRES_URL
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()
const r = await client.query(
  `SELECT plan_name, ai_nums, project_nums, seats, is_active
   FROM subscription_limit
   WHERE organization_id = $1 AND is_active = true`,
  ['it7bqot2fuzidybro6jr990q']
)
console.log(JSON.stringify(r.rows))
await client.end()
"""
    sftp = client.open_sftp()
    with sftp.file("/tmp/verify-ent.mjs", "w") as f:
        f.write(verify)
    sftp.close()
    run(client, "docker cp /tmp/verify-ent.mjs quickxbuild-web-1:/workspace/packages/db/verify-ent.mjs")
    run(
        client,
        "docker exec -e POSTGRES_URL=\"$(tr -d '\\r' < /opt/quickxbuild/.env | sed -n 's/^POSTGRES_URL=//p')\" "
        "-w /workspace/packages/db quickxbuild-web-1 bun ./verify-ent.mjs",
    )

    # Warm compile for slow first-hit routes (dev mode)
    for path in ["/", "/login", "/dashboard", "/api/trpc/stripe.getUserPlans"]:
        run(
            client,
            f"curl -m 90 -s -o /dev/null -w '{path}=%{{http_code}} t=%{{time_total}}\\n' "
            f"http://127.0.0.1:3000{path}",
            timeout=120,
        )
    # Second pass should be fast
    for path in ["/", "/login", "/dashboard"]:
        run(
            client,
            f"curl -m 30 -s -o /dev/null -w 'warm{path}=%{{http_code}} t=%{{time_total}}\\n' "
            f"http://127.0.0.1:3000{path}",
        )

    client.close()
    print("VERIFY_DONE", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
