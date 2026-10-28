#!/usr/bin/env python3
"""Create a fresh long-lived E2B sandbox with vite template, start preview, update project, probe URL.
Requires DEPLOY_PASSWORD. Never prints secrets.
"""

from __future__ import annotations

import os
import re
import sys

import paramiko

HOST = os.environ.get("DEPLOY_HOST", "64.247.177.39")
PASSWORD = os.environ.get("DEPLOY_PASSWORD", "")
PROJECT_ID = os.environ.get("PROJECT_ID", "kaqz9ypquny655m86hgjwdrp")

JS = r"""
const { Client } = require('pg');
const { Sandbox } = require('e2b');

const PROJECT_ID = process.env.PROJECT_ID;
const apiKey = process.env.E2B_API_KEY;
const TEMPLATE = 'vite-shadcn-template-quickxbuild';

(async () => {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL;
  const pg = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await pg.connect();

  console.log('CREATE_TEMPLATE', TEMPLATE);
  const sb = await Sandbox.create(TEMPLATE, {
    apiKey,
    timeoutMs: 600_000, // 10 min
  });
  console.log('SANDBOX', sb.sandboxId);

  // Keep stored id as sandboxId (platform also sometimes appends -clientId)
  await pg.query('update project set container_id=$1, updated_at=now() where id=$2', [sb.sandboxId, PROJECT_ID]);
  console.log('DB_OK');

  async function run(cmd, timeoutMs = 120000) {
    const r = await sb.commands.run(cmd, { timeoutMs });
    console.log('>>', cmd.slice(0, 100));
    console.log('exit', r.exitCode);
    if (r.stdout) console.log(r.stdout.slice(0, 500));
    if (r.stderr) console.log('ERR', r.stderr.slice(0, 300));
    return r;
  }

  await run('ls -la /home/user | head -30');
  // template layout
  await run('ls -la /home/user/vite-shadcn-template-quickxbuild 2>/dev/null | head -20 || ls -la /home/user/* 2>/dev/null | head -40');

  // ensure deps + start vite in background
  const start = await run(
    'bash -lc \'cd /home/user/vite-shadcn-template-quickxbuild 2>/dev/null || cd /home/user/*template* 2>/dev/null || cd /home/user; pwd; ls package.json; (test -d node_modules || bun install); nohup bun run dev -- --host 0.0.0.0 --port 5173 >/tmp/vite.log 2>&1 & echo PID=$!; for i in 1 2 3 4 5 6 7 8 9 10; do code=$(curl -sS -o /dev/null -w "%{http_code}" http://127.0.0.1:5173/ || echo 0); echo try=$i code=$code; if [ "$code" = "200" ]; then break; fi; sleep 2; done; tail -40 /tmp/vite.log\'',
    240000
  );

  let host = sb.getHost(5173);
  let preview = String(host);
  if (!/^https?:/i.test(preview)) preview = 'https://' + preview;
  preview = preview.replace(/\.e2b\.dev(?=[:/?#]|$)/gi, '.e2b.app');
  console.log('PREVIEW_URL', preview);

  for (let i = 0; i < 8; i++) {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 15000);
      const res = await fetch(preview, { signal: ac.signal, redirect: 'follow' });
      clearTimeout(t);
      console.log('PREVIEW_HTTP', res.status, 'try', i);
      if (res.status >= 200 && res.status < 400) break;
    } catch (e) {
      console.log('PREVIEW_TRY_ERR', i, String(e.message || e).slice(0, 100));
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  await pg.end();
  console.log('CREATE_LIVE_DONE');
})().catch((e) => {
  console.error('CREATE_LIVE_FAIL', e && e.stack || e);
  process.exit(1);
});
"""


def main() -> int:
    if not PASSWORD:
        print("DEPLOY_PASSWORD required", file=sys.stderr)
        return 1
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", password=PASSWORD, timeout=60)
    sftp = client.open_sftp()
    with sftp.file("/tmp/create-live-preview.js", "w") as f:
        f.write(JS)
    sftp.close()
    remote = f"""
set -e
cid=$(docker ps -qf name=quickxbuild-web | head -1)
echo CID=$cid BUILD_ID=$(docker exec "$cid" cat /workspace/apps/web/.next/BUILD_ID)
docker cp /tmp/create-live-preview.js "$cid":/workspace/create-live-preview.js
docker exec -e PROJECT_ID={PROJECT_ID} -e NODE_PATH=/workspace/node_modules -w /workspace "$cid" node /workspace/create-live-preview.js
echo DONE
"""
    _i, out, err = client.exec_command(remote, timeout=360)
    text = (out.read() + err.read()).decode("utf-8", "replace")
    text = re.sub(r"(e2b_[A-Za-z0-9]+)", "e2b_[REDACTED]", text)
    print(text)
    client.close()
    return 0 if "CREATE_LIVE_DONE" in text and "PREVIEW_HTTP 200" in text else 1


if __name__ == "__main__":
    raise SystemExit(main())
