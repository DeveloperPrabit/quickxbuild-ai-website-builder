#!/usr/bin/env python3
"""Inside resumed E2B sandbox: list processes/ports, start vite if needed, probe preview.
Requires DEPLOY_PASSWORD.
"""

from __future__ import annotations

import os
import re
import sys

import paramiko

HOST = os.environ.get("DEPLOY_HOST", "64.247.177.39")
PASSWORD = os.environ.get("DEPLOY_PASSWORD", "")
SANDBOX = os.environ.get("SANDBOX_ID", "i46e6pgcu1b72xw7hu12l")

JS = r"""
const { Sandbox } = require('e2b');
const apiKey = process.env.E2B_API_KEY;
const id = process.env.SANDBOX_ID;
(async () => {
  const sb = await Sandbox.connect(id, { apiKey, timeoutMs: 60_000 });
  console.log('CONNECTED', sb.sandboxId);
  const host = sb.getHost(5173);
  const url = 'https://' + String(host).replace(/\.e2b\.dev(?=[:/?#]|$)/gi, '.e2b.app');
  console.log('HOST', url);

  async function run(cmd) {
    const r = await sb.commands.run(cmd, { timeoutMs: 90_000 });
    console.log('CMD', cmd.slice(0, 80), 'exit', r.exitCode);
    console.log((r.stdout || '').slice(0, 400));
    console.log((r.stderr || '').slice(0, 400));
    return r;
  }

  await run('pwd; ls -la /home/user 2>/dev/null | head -20; ls -la /home/user/vite-shadcn-template-quickxbuild 2>/dev/null | head -15');
  await run('ps aux | head -40');
  await run('ss -lntp 2>/dev/null || netstat -lntp 2>/dev/null || true');

  // start vite if nothing on 5173
  const check = await sb.commands.run('curl -sS -o /dev/null -w "%{http_code}" http://127.0.0.1:5173/ || echo down', { timeoutMs: 15_000 });
  console.log('LOCAL_5173', (check.stdout || '').trim());
  if (!/200|304|302/.test(check.stdout || '')) {
    console.log('STARTING_VITE');
    // non-blocking start
    await sb.commands.run(
      'cd /home/user/vite-shadcn-template-quickxbuild && (test -d node_modules || bun install --frozen-lockfile || bun install) && nohup bun run dev --host 0.0.0.0 --port 5173 > /tmp/vite.log 2>&1 & echo VITE_PID=$!; sleep 4; curl -sS -o /dev/null -w "AFTER=%{http_code}\\n" http://127.0.0.1:5173/ || true; tail -30 /tmp/vite.log || true',
      { timeoutMs: 180_000 }
    ).then(r => { console.log(r.stdout?.slice(0,800)); console.log(r.stderr?.slice(0,400)); });
  }

  for (const u of [url, url.replace('.e2b.app','.e2b.dev')]) {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 20000);
      const res = await fetch(u, { signal: ac.signal, redirect: 'follow' });
      clearTimeout(t);
      console.log('FETCH', u, res.status);
    } catch (e) {
      console.log('FETCH_ERR', u, String(e.message||e).slice(0,120));
    }
  }
  console.log('VITE_PROBE_DONE');
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
    with sftp.file("/tmp/vite-probe.js", "w") as f:
        f.write(JS)
    sftp.close()
    remote = f"""
set -e
cid=$(docker ps -qf name=quickxbuild-web | head -1)
docker cp /tmp/vite-probe.js "$cid":/workspace/vite-probe.js
docker exec -e SANDBOX_ID={SANDBOX} -e NODE_PATH=/workspace/node_modules -w /workspace "$cid" node /workspace/vite-probe.js
"""
    _i, out, err = client.exec_command(remote, timeout=300)
    text = (out.read() + err.read()).decode("utf-8", "replace")
    text = re.sub(r"(e2b_[A-Za-z0-9]+)", "e2b_[REDACTED]", text)
    print(text)
    client.close()
    return 0 if "VITE_PROBE_DONE" in text else 1


if __name__ == "__main__":
    raise SystemExit(main())
