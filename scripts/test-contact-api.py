#!/usr/bin/env python3
import os
import paramiko

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("64.247.177.39", username="root", password=os.environ["DEPLOY_PASSWORD"], timeout=60)

def run(cmd: str) -> None:
    print("$", cmd[:160], flush=True)
    _, o, _ = c.exec_command(cmd, get_pty=True, timeout=60)
    print(o.read().decode("utf-8", "replace")[-2000:], flush=True)

run(
    "curl -m 30 -s -X POST http://127.0.0.1:3000/api/contact "
    "-H 'Content-Type: application/json' "
    "-d '{\"name\":\"Owner Test\",\"email\":\"tester@example.com\",\"company\":\"QX\",\"message\":\"Contact form wiring check\"}'"
)
run(
    "docker exec -w /workspace/apps/web -e NODE_ENV=development quickxbuild-web-1 "
    "bunx wrangler d1 execute quickxbuild --local --json --command="
    "\"SELECT id,name FROM plan WHERE is_active=1\""
)
run(
    "docker exec -w /workspace/apps/web -e NODE_ENV=development quickxbuild-web-1 "
    "bunx wrangler d1 execute quickxbuild --local --json --command="
    "\"SELECT plan,status FROM subscription\""
)
c.close()
