#!/usr/bin/env python3
"""Upload prebuilt .next + prod scripts to VPS and restart web on next start."""
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
APP_DIR = "/opt/quickxbuild"
ROOT = Path(__file__).resolve().parents[1]
WEB_NEXT = ROOT / "apps" / "web" / ".next"


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


def filter_member(tarinfo: tarfile.TarInfo) -> tarfile.TarInfo | None:
    name = tarinfo.name.replace("\\", "/")
    # Drop build caches — not needed at runtime
    parts = name.split("/")
    if "cache" in parts or name.endswith("/trace") or name.endswith(".nft.json"):
        return None
    return tarinfo


def main() -> int:
    if not PASSWORD:
        print("ERROR: set DEPLOY_PASSWORD in the environment", flush=True)
        return 1
    if not (WEB_NEXT / "BUILD_ID").is_file():
        print("ERROR: apps/web/.next/BUILD_ID missing — run LIGHT_NEXT_BUILD=1 bun run build first", flush=True)
        return 1

    build_id = (WEB_NEXT / "BUILD_ID").read_text(encoding="utf-8").strip()
    print(f"BUILD_ID={build_id}", flush=True)

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASSWORD, timeout=60)
    print("SSH connected", flush=True)

    with tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False) as tmp:
        tar_path = Path(tmp.name)

    print(f"Packing .next -> {tar_path}", flush=True)
    with tarfile.open(tar_path, "w:gz") as tar:
        tar.add(WEB_NEXT, arcname=".next", filter=filter_member)
    size_mb = tar_path.stat().st_size / (1024 * 1024)
    print(f"tarball={size_mb:.1f} MB", flush=True)

    sftp = client.open_sftp()
    remote_tar = f"{APP_DIR}/.next-upload.tar.gz"
    print(f"Uploading to {remote_tar} ...", flush=True)

    # Chunked put with reconnect — large tarballs often trip mid-transfer on this VPS.
    last_err: Exception | None = None
    for attempt in range(1, 6):
        try:
            if attempt > 1:
                print(f"Retry upload attempt {attempt}/5 ...", flush=True)
                try:
                    sftp.close()
                except Exception:
                    pass
                try:
                    client.close()
                except Exception:
                    pass
                client = paramiko.SSHClient()
                client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
                client.connect(HOST, username=USER, password=PASSWORD, timeout=90, banner_timeout=90)
                transport = client.get_transport()
                if transport:
                    transport.set_keepalive(15)
                sftp = client.open_sftp()
            else:
                transport = client.get_transport()
                if transport:
                    transport.set_keepalive(15)

            def _progress(transferred: int, total: int) -> None:
                if total <= 0:
                    return
                if transferred == total or transferred % (5 * 1024 * 1024) < 32768:
                    pct = 100.0 * transferred / total
                    print(f"  upload {pct:.0f}% ({transferred // (1024 * 1024)}/{total // (1024 * 1024)} MB)", flush=True)

            sftp.get_channel().settimeout(300)
            sftp.put(str(tar_path), remote_tar, callback=_progress)
            last_err = None
            break
        except Exception as err:
            last_err = err
            print(f"Upload failed attempt {attempt}: {err}", flush=True)
            time.sleep(3 * attempt)
    if last_err is not None:
        raise last_err
    print("Uploaded tarball", flush=True)

    # Scripts + compose that prefer next start
    for local, remote in [
        (ROOT / "scripts" / "web-prod.sh", f"{APP_DIR}/scripts/web-prod.sh"),
        (ROOT / "docker-compose.prod.yml", f"{APP_DIR}/docker-compose.prod.yml"),
        (ROOT / "docker-compose.override.prod.yml", f"{APP_DIR}/docker-compose.override.prod.yml"),
    ]:
        if local.is_file():
            # ensure remote dir
            remote_dir = str(Path(remote).parent).replace("\\", "/")
            run(client, f"mkdir -p {remote_dir}")
            # Binary write avoids paramiko put size-mismatch on some VPS links.
            data = local.read_bytes()
            with sftp.file(remote, "wb") as handle:
                handle.write(data)
            print(f"uploaded {local.name}", flush=True)

    sftp.close()
    tar_path.unlink(missing_ok=True)

    cmds = [
        f"mkdir -p {APP_DIR}/apps/web {APP_DIR}/scripts",
        f"sed -i 's/\\r$//' {APP_DIR}/scripts/web-prod.sh && chmod +x {APP_DIR}/scripts/web-prod.sh",
        # stop web so volume isn't busy
        f"cd {APP_DIR} && docker compose -f docker-compose.prod.yml -f docker-compose.override.prod.yml stop web || true",
        f"rm -rf {APP_DIR}/apps/web/.next",
        f"mkdir -p {APP_DIR}/apps/web",
        f"tar -xzf {APP_DIR}/.next-upload.tar.gz -C {APP_DIR}/apps/web",
        f"test -f {APP_DIR}/apps/web/.next/BUILD_ID && cat {APP_DIR}/apps/web/.next/BUILD_ID",
        f"rm -f {APP_DIR}/.next-upload.tar.gz",
        f"cd {APP_DIR} && docker compose -f docker-compose.prod.yml -f docker-compose.override.prod.yml up -d --force-recreate web",
    ]
    for cmd in cmds:
        code, _ = run(client, cmd, timeout=900)
        if code != 0 and "stop web" not in cmd:
            print(f"FAILED ({code}): {cmd}", flush=True)
            client.close()
            return code or 1

    print("Waiting for next start...", flush=True)
    time.sleep(8)
    run(client, "docker logs --tail 80 $(docker ps -qf name=web | head -1) 2>&1 || docker compose -f /opt/quickxbuild/docker-compose.prod.yml logs --tail 80 web", timeout=60)
    run(client, "curl -sI -o /dev /null -w '%{http_code} %{time_total}\\n' http://127.0.0.1:3000/ || true", timeout=60)
    run(client, "curl -sI -o /dev/null -w '%{http_code} %{time_total}\\n' https://websitebuilder.techspireglobal.com/ || true", timeout=60)
    client.close()
    print("DONE", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
