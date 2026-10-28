#!/usr/bin/env python3
"""Upload e2b@2.x + runtime deps into the live web container node_modules.
Requires DEPLOY_PASSWORD.
"""

from __future__ import annotations

import os
import sys
import tarfile
import tempfile
from pathlib import Path

import paramiko

HOST = os.environ.get("DEPLOY_HOST", "64.247.177.39")
PASSWORD = os.environ.get("DEPLOY_PASSWORD", "")
ROOT = Path(__file__).resolve().parents[1]
NM = ROOT / "node_modules"

# Packages required at runtime by e2b@2.61
PKGS = [
    "e2b",
    "@bufbuild",
    "@connectrpc",
    "@e2b",
    "chalk",
    "compare-versions",
    "glob",
    "openapi-fetch",
    "platform",
    "tar",
    "undici",
    "minimatch",
    "brace-expansion",
    "balanced-match",
    "path-scurry",
    "lru-cache",
    "minipass",
    "yallist",
    "openapi-typescript-helpers",
    "emoji-regex",
]


def add_path(tar: tarfile.TarFile, src: Path, arcname: str) -> None:
    if not src.exists():
        print(f"SKIP missing {src}")
        return
    tar.add(src, arcname=arcname, recursive=True)
    print(f"ADD {arcname}")


def main() -> int:
    if not PASSWORD:
        print("DEPLOY_PASSWORD required", file=sys.stderr)
        return 1

    with tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False) as tmp:
        tarball = tmp.name
    with tarfile.open(tarball, "w:gz") as tar:
        for name in PKGS:
            src = NM / name
            add_path(tar, src, f"node_modules/{name}")

    size_mb = os.path.getsize(tarball) / (1024 * 1024)
    print(f"tarball={size_mb:.1f} MB")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", password=PASSWORD, timeout=60)
    sftp = client.open_sftp()
    remote_tar = "/tmp/e2b-sdk-upload.tar.gz"
    print("Uploading…")
    sftp.put(tarball, remote_tar)
    sftp.close()

    remote = r"""
set -e
cid=$(docker ps -qf name=quickxbuild-web | head -1)
echo CID=$cid
docker cp /tmp/e2b-sdk-upload.tar.gz "$cid":/tmp/e2b-sdk-upload.tar.gz
docker exec -w /workspace "$cid" sh -lc 'tar xzf /tmp/e2b-sdk-upload.tar.gz && node -e "console.log(\"E2B_VERSION\", require(\"e2b/package.json\").version)"'
echo SYNC_E2B_DONE
"""
    _i, out, err = client.exec_command(remote, timeout=300)
    print((out.read() + err.read()).decode("utf-8", "replace"))
    client.close()
    try:
        os.unlink(tarball)
    except OSError:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
