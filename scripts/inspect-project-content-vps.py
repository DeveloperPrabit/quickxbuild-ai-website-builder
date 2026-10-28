#!/usr/bin/env python3
"""Inspect whether project message_history contains Insane Barber content."""

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
  const r = await c.query(
    'select id, name, container_id, length(message_history::text) as mh_len from project where id=$1',
    [PROJECT_ID]
  );
  const row = r.rows[0];
  if (!row) { console.log('MISSING'); process.exit(1); }
  console.log(JSON.stringify({ id: row.id, name: row.name, container_id: row.container_id, mh_len: row.mh_len }));
  const mh = await c.query('select message_history from project where id=$1', [PROJECT_ID]);
  const raw = mh.rows[0].message_history;
  const s = typeof raw === 'string' ? raw : JSON.stringify(raw);
  for (const k of ['Insane', 'Barber', 'Precision Fades', 'Book a Chair', 'insanebarber', 'Grooming Menu', 'Master Craftsmen', 'QuickXBuild']) {
    console.log('HAS', k, s.includes(k));
  }
  const paths = [...s.matchAll(/"(?:path|filePath|filename)"\s*:\s*"([^"]+)"/g)].map(m => m[1]);
  console.log('PATH_COUNT', paths.length);
  console.log('PATH_SAMPLES', [...new Set(paths)].slice(0, 50).join('\n'));
  // message roles / plan counts
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const arr = Array.isArray(parsed) ? parsed : (parsed?.messages || parsed?.history || []);
    console.log('MSG_COUNT', Array.isArray(arr) ? arr.length : 'n/a');
    if (Array.isArray(arr)) {
      const roles = {};
      for (const m of arr) roles[m.role || m.type || '?'] = (roles[m.role || m.type || '?'] || 0) + 1;
      console.log('ROLES', JSON.stringify(roles));
      const last = arr[arr.length - 1];
      console.log('LAST_ROLE', last?.role || last?.type);
      console.log('LAST_SNIP', JSON.stringify(last).slice(0, 400));
    }
  } catch (e) {
    console.log('PARSE_ERR', e.message);
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
    with sftp.file("/tmp/inspect-project.js", "w") as f:
        f.write(JS)
    sftp.close()
    remote = f"""
cid=$(docker ps -qf name=quickxbuild-web | head -1)
docker cp /tmp/inspect-project.js "$cid":/workspace/inspect-project.js
docker exec -e PROJECT_ID={PROJECT_ID} -e NODE_PATH=/workspace/node_modules -w /workspace "$cid" node /workspace/inspect-project.js
"""
    _i, out, err = client.exec_command(remote, timeout=120)
    print((out.read() + err.read()).decode("utf-8", "replace"))
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
