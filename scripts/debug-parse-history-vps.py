#!/usr/bin/env python3
from __future__ import annotations

import os
import sys
import paramiko

HOST = os.environ.get("DEPLOY_HOST", "64.247.177.39")
PASSWORD = os.environ.get("DEPLOY_PASSWORD", "")
PROJECT_ID = os.environ.get("PROJECT_ID", "kaqz9ypquny655m86hgjwdrp")

JS = r"""
const { Client } = require('pg');
(async () => {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL;
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const r = await c.query('select message_history from project where id=$1', [process.env.PROJECT_ID]);
  let raw = r.rows[0].message_history;
  console.log('typeof', typeof raw);
  if (typeof raw === 'string') {
    console.log('str_len', raw.length);
    raw = JSON.parse(raw);
  }
  console.log('isArray', Array.isArray(raw), 'len', raw?.length);
  const diffs = (raw || []).filter(m => m && m.type === 'diff');
  console.log('diff_msgs', diffs.length);
  let n = 0;
  for (const msg of diffs) {
    console.log('diff_isArray', Array.isArray(msg.diff), 'diff_len', msg.diff?.length, 'first_keys', msg.diff?.[0] ? Object.keys(msg.diff[0]).join(',') : '');
    for (const f of msg.diff || []) {
      if (typeof f.modified === 'string') n++;
    }
  }
  console.log('modified_files', n);
  const sample = diffs[0]?.diff?.[0];
  if (sample) console.log('sample', sample.type, sample.path, 'mod_len', (sample.modified||'').length);
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
"""

def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", password=PASSWORD, timeout=60)
    sftp = client.open_sftp()
    with sftp.file("/tmp/debug-parse.js", "w") as f:
        f.write(JS)
    sftp.close()
    remote = f"""
cid=$(docker ps -qf name=quickxbuild-web | head -1)
docker cp /tmp/debug-parse.js "$cid":/workspace/debug-parse.js
docker exec -e PROJECT_ID={PROJECT_ID} -e NODE_PATH=/workspace/node_modules -w /workspace "$cid" node /workspace/debug-parse.js
"""
    _i, out, err = client.exec_command(remote, timeout=120)
    print((out.read() + err.read()).decode("utf-8", "replace"))
    client.close()
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
