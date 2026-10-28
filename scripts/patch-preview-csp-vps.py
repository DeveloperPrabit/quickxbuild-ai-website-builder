#!/usr/bin/env python3
"""Patch live E2B sandbox Vite CSP so websitebuilder can iframe the preview.

Connects to the project's sandbox, rewrites frame-ancestors to allow https parents
(including websitebuilder.techspireglobal.com), restarts Vite, probes CSP headers.
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
SANDBOX_HINT = os.environ.get("SANDBOX_ID", "iyki7uw3qpvlqp427pfox")

JS = r"""
const { Client } = require('pg');
const { Sandbox } = require('e2b');

const PROJECT_ID = process.env.PROJECT_ID;
const SANDBOX_HINT = process.env.SANDBOX_HINT || '';
const apiKey = process.env.E2B_API_KEY;
const ROOT = '/home/user/vite-shadcn-template-quickxbuild';
const VITE = ROOT + '/vite.config.ts';
const BUILDER = 'https://websitebuilder.techspireglobal.com';
const CSP =
  "frame-ancestors 'self' http://localhost:* https://localhost:* http://127.0.0.1:* https://127.0.0.1:* " +
  BUILDER +
  ' https:';

function patchConfig(src) {
  const replacement =
    'function frameAncestorCsp(): string {\n  return ' + JSON.stringify(CSP) + '\n}';
  if (/function frameAncestorCsp\(\): string \{[\s\S]*?\n\}/.test(src)) {
    return src.replace(/function frameAncestorCsp\(\): string \{[\s\S]*?\n\}/, replacement);
  }
  if (/Content-Security-Policy/.test(src)) {
    return src.replace(
      /'Content-Security-Policy'\s*:\s*[^,\n]+/,
      "'Content-Security-Policy': " + JSON.stringify(CSP)
    );
  }
  return src.replace(
    /server:\s*\{/,
    "server: {\n      headers: { 'Content-Security-Policy': " + JSON.stringify(CSP) + ' },'
  );
}

async function connectSandbox(pg) {
  const r = await pg.query('select container_id from project where id=$1', [PROJECT_ID]);
  const cid = (r.rows[0] && r.rows[0].container_id) || '';
  console.log('PROJECT_CONTAINER', cid);
  const candidates = [
    SANDBOX_HINT,
    cid,
    cid.includes('-') ? cid.split('-')[0] : '',
  ].filter(Boolean);
  const seen = new Set();
  for (const id of candidates) {
    if (seen.has(id)) continue;
    seen.add(id);
    try {
      console.log('TRY_CONNECT', id);
      const sb = await Sandbox.connect(id, { apiKey, timeoutMs: 90_000 });
      console.log('CONNECT_OK', sb.sandboxId);
      return sb;
    } catch (e) {
      console.log('CONNECT_FAIL', id, String(e && e.message || e).slice(0, 180));
    }
  }
  const template =
    process.env.E2B_TEMPLATE ||
    process.env.E2B_TEMPLATE_ID ||
    'vite-shadcn-template-quickxbuild';
  console.log('TRY_CREATE', template);
  const sb = await Sandbox.create(template, { apiKey, timeoutMs: 180_000 });
  console.log('CREATE_OK', sb.sandboxId);
  await pg.query(
    'update project set container_id = $1, updated_at = now() where id = $2',
    [sb.sandboxId, PROJECT_ID]
  );
  console.log('DB_UPDATED', sb.sandboxId);
  return sb;
}

(async () => {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL;
  const pg = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await pg.connect();
  const sb = await connectSandbox(pg);
  await pg.end();

  let raw = '';
  try {
    raw = String(await sb.files.read(VITE));
    console.log('VITE_LEN', raw.length);
    const snip = (raw.match(/frame-ancestors[^"']*/i) || ['(none)'])[0];
    console.log('CSP_BEFORE', snip.slice(0, 200));
  } catch (e) {
    console.log('READ_FAIL', String(e && e.message || e).slice(0, 200));
  }

  if (raw) {
    const next = patchConfig(raw);
    if (next !== raw) {
      await sb.files.write(VITE, next);
      console.log('WRITE_OK');
    } else {
      console.log('WRITE_SKIP_NO_CHANGE');
    }
    const after = String(await sb.files.read(VITE));
    const snip2 = (after.match(/frame-ancestors[^"']*/i) || ['(none)'])[0];
    console.log('CSP_AFTER', snip2.slice(0, 220));
  }

  // Restart Vite with builder origin env
  const envExports =
    'NEXT_PUBLIC_APP_URL=' + JSON.stringify(BUILDER) +
    ' PREVIEW_FRAME_ANCESTORS=' + JSON.stringify(BUILDER + ' https:');
  const cmd =
    'cd ' + ROOT + ' && ' + envExports +
    ' (pkill -f vite || true); sleep 1; nohup bun run dev --host 0.0.0.0 --port 5173 >/tmp/vite-preview.log 2>&1 & sleep 3; head -n 20 /tmp/vite-preview.log || true';
  try {
    const r = await sb.commands.run(cmd, { timeoutMs: 25_000 });
    console.log('RESTART', r.exitCode, String(r.stdout || '').slice(0, 300).replace(/\n/g, ' | '));
  } catch (e) {
    console.log('RESTART_FAIL', String(e && e.message || e).slice(0, 220));
  }

  const host = sb.getHost(5173);
  const preview = (String(host).startsWith('http') ? String(host) : 'https://' + host)
    .replace(/\.e2b\.dev/gi, '.e2b.app');
  console.log('PREVIEW_URL', preview);

  // Probe CSP from inside the container network path via node fetch
  await new Promise((r) => setTimeout(r, 2500));
  try {
    const res = await fetch(preview, { redirect: 'follow' });
    const csp = res.headers.get('content-security-policy') || '';
    console.log('HTTP', res.status);
    console.log('CSP_HEADER', csp.slice(0, 260) || '(missing)');
    const ok =
      /frame-ancestors/i.test(csp) &&
      (/https:/.test(csp) || /websitebuilder\.techspireglobal\.com/.test(csp));
    console.log(ok ? 'CSP_EMBED_OK' : 'CSP_EMBED_BAD');
  } catch (e) {
    console.log('PROBE_FAIL', String(e && e.message || e).slice(0, 200));
  }

  console.log('PATCH_CSP_DONE');
})().catch((e) => {
  console.error('PATCH_CSP_FAIL', e && e.stack || e);
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
    with sftp.file("/tmp/patch-preview-csp.js", "w") as f:
        f.write(JS)
    sftp.close()
    remote = f"""
set -e
cid=$(docker ps -qf name=quickxbuild-web | head -1)
echo CID=$cid
docker cp /tmp/patch-preview-csp.js "$cid":/workspace/patch-preview-csp.js
docker exec -e PROJECT_ID={PROJECT_ID} -e SANDBOX_HINT={SANDBOX_HINT} -e NODE_PATH=/workspace/node_modules -w /workspace "$cid" \
  node /workspace/patch-preview-csp.js
"""
    _i, out, err = client.exec_command(remote, timeout=240)
    text = (out.read() + err.read()).decode("utf-8", "replace")
    text = re.sub(r"(e2b_[A-Za-z0-9]+)", "e2b_[REDACTED]", text)
    print(text)
    client.close()
    return 0 if "PATCH_CSP_DONE" in text else 1


if __name__ == "__main__":
    raise SystemExit(main())
