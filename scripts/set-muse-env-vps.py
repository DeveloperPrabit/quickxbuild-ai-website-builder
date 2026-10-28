#!/usr/bin/env python3
"""Upsert Meta Muse Spark env on the QuickXBuild VPS and recreate web (env only).

Requires DEPLOY_PASSWORD. Does not print secret values.
Usage:
  set DEPLOY_PASSWORD=...
  python scripts/set-muse-env-vps.py
"""

from __future__ import annotations

import os
import sys

import paramiko

HOST = os.environ.get("DEPLOY_HOST", "64.247.177.39")
PASSWORD = os.environ.get("DEPLOY_PASSWORD", "")
APP_DIR = os.environ.get("DEPLOY_DIR", "/opt/quickxbuild")

# Prefer local .env MODEL_API_KEY; allow override via env for one-shot deploys.
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def read_local_key() -> str:
    override = os.environ.get("MODEL_API_KEY", "").strip()
    if override:
        return override
    path = os.path.join(ROOT, ".env")
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            if line.startswith("MODEL_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


def main() -> int:
    if not PASSWORD:
        print("DEPLOY_PASSWORD is required", file=sys.stderr)
        return 1
    key = read_local_key()
    if not key.startswith("LLM_"):
        print("MODEL_API_KEY missing or invalid in local .env / env", file=sys.stderr)
        return 1

    base = os.environ.get("MODEL_API_BASE_URL", "https://api.meta.ai/v1")
    model = os.environ.get("MODEL_NAME", "muse-spark-1.3")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", password=PASSWORD, timeout=60)

    def run(cmd: str) -> tuple[int, str]:
        _stdin, stdout, stderr = client.exec_command(cmd, timeout=180)
        out = (stdout.read() + stderr.read()).decode("utf-8", "replace")
        code = stdout.channel.recv_exit_status()
        return code, out

    # Upsert without echoing values into shell history via a remote heredoc file.
    remote_script = f"""
set -e
ENV={APP_DIR}/.env
touch "$ENV"
upsert() {{
  local k="$1" v="$2"
  if grep -q "^${{k}}=" "$ENV"; then
    sed -i "s|^${{k}}=.*|${{k}}=${{v}}|" "$ENV"
  else
    printf '\\n%s=%s\\n' "$k" "$v" >> "$ENV"
  fi
}}
upsert MODEL_API_KEY '{key}'
upsert MODEL_API_BASE_URL '{base}'
upsert MODEL_NAME '{model}'
upsert AI_PROVIDER muse
grep -E '^(MODEL_API_KEY|MODEL_API_BASE_URL|MODEL_NAME|AI_PROVIDER)=' "$ENV" | sed 's/=.*/=<set>/'
cd {APP_DIR}
docker compose -f docker-compose.prod.yml -f docker-compose.override.prod.yml up -d --force-recreate --no-deps web
sleep 3
docker compose -f docker-compose.prod.yml -f docker-compose.override.prod.yml ps web
# Confirm web container sees Muse env (length only — never print the secret)
cid=$(docker ps -qf name=quickxbuild-web | head -1)
if [ -n "$cid" ]; then
  docker exec "$cid" sh -lc 'echo MODEL_API_KEY_LEN=${{#MODEL_API_KEY}}; echo MODEL_NAME=$MODEL_NAME; echo AI_PROVIDER=$AI_PROVIDER; echo MODEL_API_BASE_URL=$MODEL_API_BASE_URL'
  # Live Meta auth probe (HTTP status only; never echo the key)
  code_http=$(docker exec "$cid" sh -lc "curl -sS -o /dev/null -w '%{{{{http_code}}}}' -H \\"Authorization: Bearer $MODEL_API_KEY\\" \\"$MODEL_API_BASE_URL/models\\" || echo fail")
  echo "META_HTTP=$code_http"
fi
"""
    code, out = run(remote_script)
    client.close()
    print(out.strip())
    print(f"exit={code}")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
