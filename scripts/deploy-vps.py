#!/usr/bin/env python3
"""Upload lean tarball + .env to VPS and run docker compose prod."""
from __future__ import annotations

import os
import sys
import tarfile
import tempfile
import time
from pathlib import Path

try:
    import paramiko
except ImportError:
    os.system(f"{sys.executable} -m pip install --quiet paramiko")
    import paramiko

HOST = os.environ.get("DEPLOY_HOST", "64.247.177.39")
USER = os.environ.get("DEPLOY_USER", "root")
PASSWORD = os.environ.get("DEPLOY_PASSWORD", "")
APP_DIR = os.environ.get("DEPLOY_DIR", "/opt/quickxbuild")
DOMAIN = "websitebuilder.techspireglobal.com"
ROOT = Path(__file__).resolve().parents[1]

EXCLUDE_DIRS = {
    "node_modules",
    ".git",
    ".next",
    ".turbo",
    ".wrangler",
    ".augment",
    ".junie",
    ".kiro",
    ".specify",
    ".cursor",
    ".vscode",
    ".idea",
    "coverage",
    "out",
    ".cache",
}
# Only the root campaign folder (not apps/web/components/marketing)
EXCLUDE_ROOT_DIRS = {"marketing"}
EXCLUDE_FILES = {
    ".DS_Store",
    "Thumbs.db",
    ".env",
    ".env.local",
    ".env.production.local",
    "bun.lockb",
}


def should_skip(path: Path) -> bool:
    parts = path.parts
    if parts and parts[0] in EXCLUDE_ROOT_DIRS:
        return True
    if set(parts) & EXCLUDE_DIRS:
        return True
    if path.name in EXCLUDE_FILES:
        return True
    if path.suffix in {".mp4", ".mp3", ".log"}:
        return True
    return False


def make_tarball(dest: Path) -> None:
    print(f"Creating archive {dest}...", flush=True)
    count = 0
    with tarfile.open(dest, "w:gz") as tar:
        for path in ROOT.rglob("*"):
            if not path.is_file():
                continue
            rel = path.relative_to(ROOT)
            if should_skip(rel):
                continue
            tar.add(path, arcname=str(rel).replace("\\", "/"))
            count += 1
            if count % 500 == 0:
                print(f"  packed {count} files...", flush=True)
    print(f"Packed {count} files, size={dest.stat().st_size / 1e6:.1f} MB", flush=True)


def safe_write(stream, text: str) -> None:
    try:
        stream.write(text)
    except UnicodeEncodeError:
        stream.write(text.encode("ascii", "replace").decode("ascii"))
    stream.flush()


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 1800) -> tuple[int, str]:
    print(f"$ {cmd}", flush=True)
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout, get_pty=True)
    channel = stdout.channel
    buf = []
    while True:
        if channel.recv_ready():
            chunk = channel.recv(4096).decode("utf-8", errors="replace")
            safe_write(sys.stdout, chunk)
            buf.append(chunk)
        if channel.recv_stderr_ready():
            chunk = channel.recv_stderr(4096).decode("utf-8", errors="replace")
            safe_write(sys.stderr, chunk)
            buf.append(chunk)
        if channel.exit_status_ready() and not channel.recv_ready() and not channel.recv_stderr_ready():
            break
        time.sleep(0.05)
    code = channel.recv_exit_status()
    return code, "".join(buf)


def main() -> int:
    if not PASSWORD:
        print("Set DEPLOY_PASSWORD", file=sys.stderr)
        return 1

    with tempfile.TemporaryDirectory() as tmp:
        tarball = Path(tmp) / "quickxbuild.tar.gz"
        make_tarball(tarball)

        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        print(f"Connecting {USER}@{HOST}...", flush=True)
        client.connect(HOST, username=USER, password=PASSWORD, timeout=30, banner_timeout=30)

        run(client, "command -v docker >/dev/null || (curl -fsSL https://get.docker.com | sh)", 600)
        run(client, f"mkdir -p {APP_DIR} /tmp/qx-upload && rm -rf {APP_DIR}/* {APP_DIR}/.[!.]* 2>/dev/null; true")

        sftp = client.open_sftp()
        remote_tar = "/tmp/qx-upload/quickxbuild.tar.gz"
        print(f"Uploading tarball -> {remote_tar}", flush=True)
        sftp.put(str(tarball), remote_tar)
        print("Uploading .env", flush=True)
        sftp.put(str(ROOT / ".env"), f"{APP_DIR}/.env")
        sftp.close()

        code, _ = run(
            client,
            f"mkdir -p {APP_DIR} && tar -xzf {remote_tar} -C {APP_DIR} && ls {APP_DIR} | head",
            300,
        )
        if code != 0:
            print("Extract failed", file=sys.stderr)
            return code

        code, _ = run(
            client,
            f"cd {APP_DIR} && docker compose -f docker-compose.prod.yml up -d --build",
            2400,
        )
        if code != 0:
            print("Compose failed", file=sys.stderr)
            run(client, f"cd {APP_DIR} && docker compose -f docker-compose.prod.yml logs --tail=80")
            client.close()
            return code

        run(client, f"cd {APP_DIR} && docker compose -f docker-compose.prod.yml ps")
        for _ in range(40):
            code, out = run(
                client,
                f"curl -sk -o /dev/null -w '%{{http_code}}' https://{DOMAIN}/ || curl -s -o /dev/null -w '%{{http_code}}' -H 'Host: {DOMAIN}' http://127.0.0.1/",
                60,
            )
            if any(x in out for x in ("200", "301", "302", "308")):
                print(f"HTTP OK: {out.strip()}", flush=True)
                break
            time.sleep(15)
        else:
            print("Site not ready yet — check docker logs", file=sys.stderr)

        client.close()
        print(f"Done. Open https://{DOMAIN}", flush=True)
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
