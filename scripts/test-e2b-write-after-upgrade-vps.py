#!/usr/bin/env python3
"""After e2b upgrade: create sandbox, write file, read back, kill."""

from __future__ import annotations

import os
import sys

import paramiko

HOST = os.environ.get("DEPLOY_HOST", "64.247.177.39")
PASSWORD = os.environ.get("DEPLOY_PASSWORD", "")

JS = r"""
const { Sandbox } = require('e2b');
const apiKey = process.env.E2B_API_KEY;
(async () => {
  console.log('E2B_VERSION', require('e2b/package.json').version);
  const sb = await Sandbox.create('vite-shadcn-template-quickxbuild', { apiKey, timeoutMs: 300000 });
  console.log('CREATED', sb.sandboxId);
  const probe = 'insane-barber-probe-' + Date.now();
  await sb.files.write('/home/user/vite-shadcn-template-quickxbuild/__probe.txt', probe);
  const back = await sb.files.read('/home/user/vite-shadcn-template-quickxbuild/__probe.txt');
  console.log('WRITE_READ_OK', String(back).trim() === probe);
  const r = await sb.commands.run('echo CMD_OK && head -c 40 /home/user/vite-shadcn-template-quickxbuild/__probe.txt', { timeoutMs: 20000 });
  console.log('CMD', r.exitCode, (r.stdout||'').trim());
  console.log('HOST', sb.getHost(5173));
  await Sandbox.kill(sb.sandboxId);
  console.log('TEST_OK');
})().catch(e => { console.error('TEST_FAIL', e && e.stack || e); process.exit(1); });
"""


def main() -> int:
    if not PASSWORD:
        print("DEPLOY_PASSWORD required", file=sys.stderr)
        return 1
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", password=PASSWORD, timeout=60)
    sftp = client.open_sftp()
    with sftp.file("/tmp/test-e2b-write.js", "w") as f:
        f.write(JS)
    sftp.close()
    remote = """
cid=$(docker ps -qf name=quickxbuild-web | head -1)
docker cp /tmp/test-e2b-write.js "$cid":/workspace/test-e2b-write.js
docker exec -e NODE_PATH=/workspace/node_modules -w /workspace "$cid" node /workspace/test-e2b-write.js
"""
    _i, out, err = client.exec_command(remote, timeout=300)
    print((out.read() + err.read()).decode("utf-8", "replace"))
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
