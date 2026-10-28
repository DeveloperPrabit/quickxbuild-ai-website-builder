#!/usr/bin/env python3
"""Diagnose E2B files.write / commands after create vs connect."""

from __future__ import annotations

import os
import sys

import paramiko

HOST = os.environ.get("DEPLOY_HOST", "64.247.177.39")
PASSWORD = os.environ.get("DEPLOY_PASSWORD", "")
PROJECT_ID = os.environ.get("PROJECT_ID", "kaqz9ypquny655m86hgjwdrp")

JS = r"""
const { Client } = require('pg');
const { Sandbox } = require('e2b');
const apiKey = process.env.E2B_API_KEY;
const PROJECT_ID = process.env.PROJECT_ID;

function keys(o) {
  try { return Object.keys(o || {}).slice(0, 40).join(','); } catch { return ''; }
}

async function tryWrite(label, sb) {
  console.log('---', label, 'id=', sb.sandboxId);
  console.log('props', keys(sb));
  console.log('has files', !!sb.files, 'has commands', !!sb.commands);
  try {
    console.log('getHost', sb.getHost(5173));
  } catch (e) {
    console.log('getHost_err', e.message);
  }
  try {
    await sb.files.write([{ path: '/home/user/vite-shadcn-template-quickxbuild/__probe.txt', data: 'probe-'+Date.now() }]);
    console.log('WRITE_OK');
  } catch (e) {
    console.log('WRITE_FAIL', String(e && e.message || e).slice(0, 250));
  }
  try {
    const r = await sb.commands.run('echo hi && ls /home/user/vite-shadcn-template-quickxbuild 2>/dev/null | head -10', { timeoutMs: 20000 });
    console.log('CMD_OK', r.exitCode, (r.stdout||'').slice(0,200));
  } catch (e) {
    console.log('CMD_FAIL', String(e && e.message || e).slice(0, 250));
  }
  try {
    const t = await sb.files.read('/home/user/vite-shadcn-template-quickxbuild/src/App.tsx');
    console.log('READ_APP_SNIP', String(t).slice(0, 120).replace(/\n/g,' '));
  } catch (e) {
    console.log('READ_FAIL', String(e && e.message || e).slice(0, 200));
  }
}

(async () => {
  console.log('E2B_KEY_LEN', (apiKey||'').length);
  console.log('SDK', require('e2b/package.json').version);

  // 1) connect to project sandbox
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL;
  const pg = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await pg.connect();
  const r = await pg.query('select container_id from project where id=$1', [PROJECT_ID]);
  const cid = r.rows[0]?.container_id || '';
  console.log('PROJECT_CONTAINER', cid);
  await pg.end();

  const ids = [...new Set([cid, cid.split('-').slice(0, -1).join('-'), cid.split('-')[0]].filter(Boolean))];
  for (const id of ids) {
    try {
      const sb = await Sandbox.connect(id, { apiKey });
      await tryWrite('connect:'+id, sb);
    } catch (e) {
      console.log('CONNECT_FAIL', id, String(e.message||e).slice(0,200));
    }
  }

  // 2) create fresh and write immediately
  try {
    const sb = await Sandbox.create('vite-shadcn-template-quickxbuild', { apiKey, timeoutMs: 300000 });
    await tryWrite('create-fresh', sb);
  } catch (e) {
    console.log('CREATE_FAIL', String(e.message||e).slice(0,250));
  }

  console.log('DIAG_DONE');
})().catch(e => { console.error(e); process.exit(1); });
"""


def main() -> int:
    if not PASSWORD:
        print("DEPLOY_PASSWORD required", file=sys.stderr)
        return 1
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", password=PASSWORD, timeout=60)
    sftp = client.open_sftp()
    with sftp.file("/tmp/diag-e2b-write.js", "w") as f:
        f.write(JS)
    sftp.close()
    remote = f"""
cid=$(docker ps -qf name=quickxbuild-web | head -1)
docker cp /tmp/diag-e2b-write.js "$cid":/workspace/diag-e2b-write.js
docker exec -e PROJECT_ID={PROJECT_ID} -e NODE_PATH=/workspace/node_modules -w /workspace "$cid" node /workspace/diag-e2b-write.js
"""
    _i, out, err = client.exec_command(remote, timeout=300)
    print((out.read() + err.read()).decode("utf-8", "replace"))
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
