#!/usr/bin/env python3
"""Exercise the live preview path without HTTP auth:
resume-or-create E2B sandbox for the project, sync-skip style, return preview URL,
update container_id, probe HTTP. Requires DEPLOY_PASSWORD. Never prints secrets.
"""

from __future__ import annotations

import os
import re
import sys

import paramiko

HOST = os.environ.get("DEPLOY_HOST", "64.247.177.39")
PASSWORD = os.environ.get("DEPLOY_PASSWORD", "")
PROJECT_ID = os.environ.get("PROJECT_ID", "kaqz9ypquny655m86hgjwdrp")

REMOTE_JS = r"""
const { Client } = require('pg');
const { Sandbox } = require('e2b');

const PROJECT_ID = process.env.PROJECT_ID;
const E2B_API_KEY = process.env.E2B_API_KEY;
const TEMPLATE = process.env.E2B_TEMPLATE || 'vite-shadcn-template-quickxbuild';

async function main() {
  if (!E2B_API_KEY) throw new Error('no E2B_API_KEY');
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL;
  const pg = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await pg.connect();
  const r = await pg.query(
    'select id, organization_id, container_id, template_type from project where id = $1',
    [PROJECT_ID]
  );
  if (!r.rows[0]) throw new Error('project missing');
  const row = r.rows[0];
  console.log('PROJECT_OK', JSON.stringify({
    id: row.id,
    org: row.organization_id,
    container_id: row.container_id,
    template_type: row.template_type,
  }));

  let sandbox = null;
  let mode = 'create';
  const raw = (row.container_id || '').trim();
  const sandboxId = raw.includes('-') ? raw.split('-')[0] : raw;

  if (sandboxId) {
    try {
      console.log('TRY_RESUME', sandboxId);
      sandbox = await Sandbox.connect(sandboxId, { apiKey: E2B_API_KEY, timeoutMs: 60_000 });
      mode = 'resume';
      console.log('RESUME_OK', sandbox.sandboxId);
    } catch (e) {
      console.log('RESUME_FAIL', String(e && e.message || e).slice(0, 200));
      await pg.query('update project set container_id = $1, updated_at = now() where id = $2', ['', PROJECT_ID]);
    }
  }

  if (!sandbox) {
    // Discover template id from env / try common ones
    const candidates = [
      process.env.E2B_TEMPLATE_ID,
      process.env.NEXT_PUBLIC_E2B_TEMPLATE_ID,
      TEMPLATE,
      'quickxbuild-vite',
      'vite-shadcn-template-quickxbuild',
      'base',
    ].filter(Boolean);
    let lastErr = null;
    for (const t of candidates) {
      try {
        console.log('TRY_CREATE', t);
        sandbox = await Sandbox.create(t, { apiKey: E2B_API_KEY, timeoutMs: 120_000 });
        mode = 'create:' + t;
        console.log('CREATE_OK', sandbox.sandboxId, 'template', t);
        break;
      } catch (e) {
        lastErr = e;
        console.log('CREATE_FAIL', t, String(e && e.message || e).slice(0, 160));
      }
    }
    if (!sandbox) throw lastErr || new Error('create failed');
  }

  // Match platform storage shape: sandboxId-clientId when present
  const stored = sandbox.sandboxId;
  await pg.query(
    'update project set container_id = $1, updated_at = now() where id = $2',
    [stored, PROJECT_ID]
  );
  console.log('DB_UPDATED', stored);

  let host;
  try {
    host = sandbox.getHost(5173);
  } catch (e) {
    host = null;
    console.log('GETHOST_ERR', String(e && e.message || e).slice(0, 120));
  }
  const url5173 = host
    ? (String(host).startsWith('http') ? String(host) : 'https://' + String(host).replace(/\\.e2b\\.dev/gi, '.e2b.app'))
    : `https://5173-${sandbox.sandboxId}.e2b.app`;
  const previewURL = url5173.replace(/\\.e2b\\.dev(?=[:/?#]|$)/gi, '.e2b.app');
  console.log('PREVIEW_URL', previewURL);
  console.log('MODE', mode);

  // quick HTTP probe from node
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 25000);
    const res = await fetch(previewURL, { signal: ac.signal, redirect: 'follow' });
    clearTimeout(t);
    console.log('PREVIEW_HTTP', res.status);
  } catch (e) {
    console.log('PREVIEW_HTTP_ERR', String(e && e.message || e).slice(0, 160));
  }

  await pg.end();
  console.log('FORCE_PREVIEW_DONE');
}

main().catch((e) => {
  console.error('FORCE_PREVIEW_FAIL', e && e.stack || e);
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
    with sftp.file("/tmp/force-preview.js", "w") as f:
        f.write(REMOTE_JS)
    sftp.close()

    remote = f"""
set -e
cid=$(docker ps -qf name=quickxbuild-web | head -1)
echo CID=$cid BUILD_ID=$(docker exec "$cid" cat /workspace/apps/web/.next/BUILD_ID)
docker cp /tmp/force-preview.js "$cid":/workspace/force-preview.js
docker exec "$cid" sh -lc 'ls /workspace/node_modules/pg/package.json /workspace/node_modules/e2b/package.json'
docker exec -e PROJECT_ID={PROJECT_ID} -e NODE_PATH=/workspace/node_modules -w /workspace "$cid" \
  node /workspace/force-preview.js
echo DONE
"""
    _i, out, err = client.exec_command(remote, timeout=240)
    text = (out.read() + err.read()).decode("utf-8", "replace")
    text = re.sub(r"(e2b_[A-Za-z0-9]+)", "e2b_[REDACTED]", text)
    print(text)
    client.close()
    ok = "PREVIEW_URL" in text and ("PREVIEW_HTTP 200" in text or "PREVIEW_HTTP 304" in text or "FORCE_PREVIEW_DONE" in text)
    return 0 if "FORCE_PREVIEW_DONE" in text else 1


if __name__ == "__main__":
    raise SystemExit(main())
