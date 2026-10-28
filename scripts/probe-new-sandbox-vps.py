#!/usr/bin/env python3
"""Probe the newly created project sandbox preview URL + confirm BUILD_ID + bundle markers.
Also try Sandbox.connect(fullId) getHost and wait for HTTP 200.
Requires DEPLOY_PASSWORD.
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

(async () => {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL;
  const pg = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await pg.connect();
  const r = await pg.query('select container_id from project where id=$1', [PROJECT_ID]);
  const containerId = r.rows[0]?.container_id || '';
  console.log('CONTAINER_ID', containerId);
  await pg.end();

  // Prefer connect with full id; also try base id
  const ids = [containerId, containerId.split('-')[0]].filter(Boolean);
  let sb = null;
  for (const id of ids) {
    try {
      console.log('CONNECT', id);
      sb = await Sandbox.connect(id, { apiKey, timeoutMs: 120000 });
      console.log('CONNECTED', sb.sandboxId);
      break;
    } catch (e) {
      console.log('CONNECT_FAIL', id, String(e.message||e).slice(0,160));
    }
  }
  if (!sb) {
    console.log('CREATE_NEW');
    sb = await Sandbox.create('vite-shadcn-template-quickxbuild', { apiKey, timeoutMs: 600000 });
    console.log('CREATED', sb.sandboxId);
    const pg2 = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
    await pg2.connect();
    await pg2.query('update project set container_id=$1, updated_at=now() where id=$2', [sb.sandboxId, PROJECT_ID]);
    await pg2.end();
  }

  // extend timeout
  try {
    if (typeof sb.setTimeout === 'function') await sb.setTimeout(600000);
  } catch (e) {
    console.log('SETTIMEOUT_SKIP', String(e.message||e).slice(0,80));
  }

  let host = sb.getHost(5173);
  let preview = String(host);
  if (!/^https?:/i.test(preview)) preview = 'https://' + preview;
  preview = preview.replace(/\.e2b\.dev(?=[:/?#]|$)/gi, '.e2b.app');
  console.log('PREVIEW_URL', preview);

  for (let i = 0; i < 20; i++) {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 12000);
      const res = await fetch(preview, { signal: ac.signal, redirect: 'follow' });
      clearTimeout(t);
      console.log('PREVIEW_HTTP', res.status, 'try', i);
      if (res.status >= 200 && res.status < 500) {
        const text = await res.text();
        console.log('BODY_SNIP', text.slice(0, 120).replace(/\n/g,' '));
        if (res.status < 400) break;
      }
    } catch (e) {
      console.log('PREVIEW_ERR', i, String(e.message||e).slice(0,100));
    }
    await new Promise(r => setTimeout(r, 3000));
  }

  // try commands with connect that has token
  try {
    const r = await sb.commands.run('echo OK; curl -sS -o /dev/null -w "%{http_code}" http://127.0.0.1:5173/ || true', { timeoutMs: 30000 });
    console.log('CMD_OK', r.exitCode, (r.stdout||'').slice(0,200));
  } catch (e) {
    console.log('CMD_FAIL', String(e.message||e).slice(0,200));
  }

  console.log('PROBE_NEW_DONE');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
"""


def main() -> int:
    if not PASSWORD:
        print("DEPLOY_PASSWORD required", file=sys.stderr)
        return 1
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", password=PASSWORD, timeout=60)
    sftp = client.open_sftp()
    with sftp.file("/tmp/probe-new.js", "w") as f:
        f.write(JS)
    sftp.close()
    remote = f"""
set -e
cid=$(docker ps -qf name=quickxbuild-web | head -1)
echo BUILD_ID=$(docker exec "$cid" cat /workspace/apps/web/.next/BUILD_ID)
echo "=== bundle preview markers ==="
docker exec "$cid" sh -lc 'grep -o "Preview URL requested" /workspace/apps/web/.next/server/chunks/1082.js | head -1; grep -o "12000" /workspace/apps/web/.next/server/chunks/5109.js | head -1'
docker cp /tmp/probe-new.js "$cid":/workspace/probe-new.js
docker exec -e PROJECT_ID={PROJECT_ID} -e NODE_PATH=/workspace/node_modules -w /workspace "$cid" node /workspace/probe-new.js
echo "=== public site ==="
curl -sS -o /dev/null -w "LIVE=%{{http_code}}\\n" --max-time 20 https://websitebuilder.techspireglobal.com/
echo DONE
"""
    _i, out, err = client.exec_command(remote, timeout=360)
    text = (out.read() + err.read()).decode("utf-8", "replace")
    text = re.sub(r"(e2b_[A-Za-z0-9]+)", "e2b_[REDACTED]", text)
    print(text)
    client.close()
    return 0 if "PROBE_NEW_DONE" in text else 1


if __name__ == "__main__":
    raise SystemExit(main())
