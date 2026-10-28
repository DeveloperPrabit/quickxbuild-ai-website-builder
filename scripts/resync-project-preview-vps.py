#!/usr/bin/env python3
"""Force-sync project files from message_history diffs into E2B and verify Insane Barber preview."""

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
const PROJECT_ID = process.env.PROJECT_ID;
const apiKey = process.env.E2B_API_KEY;
const ROOT = '/home/user/vite-shadcn-template-quickxbuild';

function collectFilesFromHistory(raw) {
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const arr = Array.isArray(parsed) ? parsed : [];
  const map = new Map();
  for (const msg of arr) {
    if (msg?.type !== 'diff' || !Array.isArray(msg.diff)) continue;
    for (const fileDiff of msg.diff) {
      const path = fileDiff.path;
      if (!path) continue;
      if (fileDiff.type === 'delete') {
        map.delete(path);
        continue;
      }
      const content = fileDiff.modified;
      if (typeof content === 'string') map.set(path, content);
    }
  }
  return map;
}

(async () => {
  console.log('E2B', require('e2b/package.json').version);
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL;
  const pg = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await pg.connect();
  const r = await pg.query('select message_history, container_id from project where id=$1', [PROJECT_ID]);
  const row = r.rows[0];
  if (!row) throw new Error('project missing');
  const fileMap = collectFilesFromHistory(row.message_history);
  console.log('FILE_COUNT', fileMap.size);
  console.log('FILES', [...fileMap.keys()].join('\n'));
  if (fileMap.size === 0) throw new Error('no files parsed from history');

  // Create fresh sandbox so we don't fight dead auth tokens from old SDK sessions
  const sb = await Sandbox.create('vite-shadcn-template-quickxbuild', { apiKey, timeoutMs: 600000 });
  console.log('CREATED', sb.sandboxId);

  const entries = [...fileMap.entries()].map(([path, content]) => ({
    path: `${ROOT}/${path}`,
    data: content,
  }));
  for (let i = 0; i < entries.length; i += 8) {
    const chunk = entries.slice(i, i + 8);
    await sb.files.write(chunk);
    console.log('WROTE', chunk.map(c => c.path.replace(ROOT+'/', '')).join(', '));
  }

  for (const p of ['index.html', 'src/App.tsx', 'src/pages/Index.tsx', 'src/index.css']) {
    try {
      const t = String(await sb.files.read(`${ROOT}/${p}`));
      console.log(
        'CHECK', p,
        'Insane=', t.includes('Insane'),
        'Barber=', t.includes('Barber'),
        'Precision=', t.includes('Precision'),
        'E50914=', t.includes('E50914') || t.includes('#E50914'),
        'len=', t.length
      );
    } catch (e) {
      console.log('CHECK_FAIL', p, e.message);
    }
  }

  // Restart vite
  try {
    const r = await sb.commands.run(
      `bash -lc 'pkill -f vite || true; pkill -f "bun.*dev" || true; cd ${ROOT} && (test -d node_modules || bun install); nohup bun run dev -- --host 0.0.0.0 --port 5173 >/tmp/vite.log 2>&1 & for i in 1 2 3 4 5 6 7 8 9 10 11 12; do code=$(curl -sS -o /dev/null -w "%{http_code}" http://127.0.0.1:5173/ || echo 0); echo try=$i code=$code; if [ "$code" = "200" ]; then break; fi; sleep 2; done; grep -i "Insane Barber\\|Precision Fades" ${ROOT}/index.html ${ROOT}/src/pages/Index.tsx 2>/dev/null | head -5; tail -20 /tmp/vite.log'`,
      { timeoutMs: 240000 }
    );
    console.log('RESTART_OUT', (r.stdout||'').slice(0, 900));
  } catch (e) {
    console.log('RESTART_FAIL', String(e.message||e).slice(0, 300));
  }

  await pg.query('update project set container_id=$1, updated_at=now() where id=$2', [sb.sandboxId, PROJECT_ID]);
  let preview = sb.getHost(5173);
  preview = String(preview).startsWith('http') ? String(preview) : 'https://' + preview;
  preview = preview.replace(/\.e2b\.dev(?=[:/?#]|$)/gi, '.e2b.app');
  console.log('PREVIEW_URL', preview);

  for (let i = 0; i < 15; i++) {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 15000);
      const res = await fetch(preview, { signal: ac.signal, redirect: 'follow' });
      clearTimeout(t);
      const body = await res.text();
      const hit = /Insane Barber|Precision Fades|Book a Chair|#E50914|#1A1A1A/i.test(body);
      console.log('PREVIEW_HTTP', res.status, 'HAS_BRAND', hit, 'try', i);
      if (res.status === 200 && hit) {
        console.log('BRAND_OK');
        break;
      }
      if (res.status === 200) console.log('BODY_SNIP', body.slice(0, 220).replace(/\n/g, ' '));
    } catch (e) {
      console.log('PREVIEW_ERR', i, String(e.message||e).slice(0, 120));
    }
    await new Promise(r => setTimeout(r, 2500));
  }

  await pg.end();
  console.log('RESYNC_DONE');
})().catch(e => { console.error('RESYNC_FAIL', e && e.stack || e); process.exit(1); });
"""


def main() -> int:
    if not PASSWORD:
        print("DEPLOY_PASSWORD required", file=sys.stderr)
        return 1
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", password=PASSWORD, timeout=60)
    sftp = client.open_sftp()
    with sftp.file("/tmp/resync-project.js", "w") as f:
        f.write(JS)
    sftp.close()
    remote = f"""
cid=$(docker ps -qf name=quickxbuild-web | head -1)
docker cp /tmp/resync-project.js "$cid":/workspace/resync-project.js
docker exec -e PROJECT_ID={PROJECT_ID} -e NODE_PATH=/workspace/node_modules -w /workspace "$cid" node /workspace/resync-project.js
"""
    _i, out, err = client.exec_command(remote, timeout=420)
    print((out.read() + err.read()).decode("utf-8", "replace"))
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
