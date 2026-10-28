#!/usr/bin/env python3
"""Dump message_history shape for one project (no file contents)."""

from __future__ import annotations

import os
import sys

import paramiko

HOST = os.environ.get("DEPLOY_HOST", "64.247.177.39")
PASSWORD = os.environ.get("DEPLOY_PASSWORD", "")
PROJECT_ID = os.environ.get("PROJECT_ID", "kaqz9ypquny655m86hgjwdrp")

JS = r"""
const { Client } = require('pg');
const PROJECT_ID = process.env.PROJECT_ID;
(async () => {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL;
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const r = await c.query('select message_history from project where id=$1', [PROJECT_ID]);
  const raw = r.rows[0].message_history;
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const arr = Array.isArray(parsed) ? parsed : [];
  console.log('COUNT', arr.length);
  for (let i = 0; i < Math.min(arr.length, 8); i++) {
    const m = arr[i];
    console.log('--- MSG', i, 'type=', m.type, 'role=', m.role, 'keys=', Object.keys(m).join(','));
    if (m.data) console.log('data_keys', typeof m.data, Array.isArray(m.data) ? 'array'+m.data.length : Object.keys(m.data||{}).slice(0,20).join(','));
    if (typeof m.content === 'string') console.log('content_snip', m.content.slice(0,180));
    else console.log('content_type', typeof m.content, Array.isArray(m.content) ? 'arr'+m.content.length : '');
  }
  // find a diff with path
  for (let i = arr.length - 1; i >= 0; i--) {
    const m = arr[i];
    const s = JSON.stringify(m);
    if (s.includes('"path"') && s.includes('Insane')) {
      console.log('HIT_INDEX', i, 'type', m.type);
      console.log('HIT_KEYS', Object.keys(m).join(','));
      console.log('HIT_SNIP', s.slice(0, 800));
      break;
    }
  }
  // last few diffs
  const diffs = arr.filter(m => m.type === 'diff').slice(-3);
  for (const d of diffs) {
    console.log('DIFF_KEYS', Object.keys(d).join(','));
    console.log('DIFF_SNIP', JSON.stringify(d).slice(0, 600));
  }
  await c.end();
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
    with sftp.file("/tmp/dump-history.js", "w") as f:
        f.write(JS)
    sftp.close()
    remote = f"""
cid=$(docker ps -qf name=quickxbuild-web | head -1)
docker cp /tmp/dump-history.js "$cid":/workspace/dump-history.js
docker exec -e PROJECT_ID={PROJECT_ID} -e NODE_PATH=/workspace/node_modules -w /workspace "$cid" node /workspace/dump-history.js
"""
    _i, out, err = client.exec_command(remote, timeout=120)
    print((out.read() + err.read()).decode("utf-8", "replace")[:12000])
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
