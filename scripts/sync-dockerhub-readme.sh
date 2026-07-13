#!/usr/bin/env bash
# Sync short + full description of the Docker Hub repo from docker/DOCKERHUB.md.
# Uses Docker Hub JWT auth (password or personal access token).
#
# Env:
#   DOCKERHUB_USERNAME  (default: rafaelsantana6)
#   DOCKERHUB_TOKEN     (required — password or personal access token)
#   DOCKERHUB_REPO      (default: zapo-rest)
#   DOCKERHUB_NAMESPACE (default: same as username)
#   DOCKERHUB_SHORT     (optional short description, ≤100 chars)
#
# Usage:
#   DOCKERHUB_TOKEN=... ./scripts/sync-dockerhub-readme.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export DOCKERHUB_USERNAME="${DOCKERHUB_USERNAME:-rafaelsantana6}"
export DOCKERHUB_TOKEN="${DOCKERHUB_TOKEN:?DOCKERHUB_TOKEN is required}"
export DOCKERHUB_NAMESPACE="${DOCKERHUB_NAMESPACE:-$DOCKERHUB_USERNAME}"
export DOCKERHUB_REPO="${DOCKERHUB_REPO:-zapo-rest}"
export DOCKERHUB_README="${DOCKERHUB_README:-$ROOT/docker/DOCKERHUB.md}"
export DOCKERHUB_SHORT="${DOCKERHUB_SHORT:-Multi-session WhatsApp REST API over zapo-js — SSE, webhooks, VoIP, dashboard}"

if [[ ! -f "$DOCKERHUB_README" ]]; then
  echo "missing $DOCKERHUB_README" >&2
  exit 1
fi

python3 <<'PY'
import json, os, sys, urllib.error, urllib.request

username = os.environ["DOCKERHUB_USERNAME"]
token = os.environ["DOCKERHUB_TOKEN"]
namespace = os.environ["DOCKERHUB_NAMESPACE"]
repo = os.environ["DOCKERHUB_REPO"]
readme_path = os.environ["DOCKERHUB_README"]
short = os.environ["DOCKERHUB_SHORT"]
if len(short) > 100:
    short = short[:97] + "..."
full = open(readme_path, encoding="utf-8").read()


def req(method: str, url: str, data=None, headers=None):
    h = {"Content-Type": "application/json", "Accept": "application/json"}
    if headers:
        h.update(headers)
    body = None if data is None else json.dumps(data).encode()
    r = urllib.request.Request(url, data=body, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=60) as res:
            raw = res.read().decode()
            return res.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        raise SystemExit(f"{method} {url} -> HTTP {e.code}: {err}") from e


print(f"→ login as {username}")
_, login = req(
    "POST",
    "https://hub.docker.com/v2/users/login/",
    {"username": username, "password": token},
)
jwt = login.get("token")
if not jwt:
    raise SystemExit(f"login failed: {login}")

print(f"→ PATCH repositories/{namespace}/{repo}/")
status, updated = req(
    "PATCH",
    f"https://hub.docker.com/v2/repositories/{namespace}/{repo}/",
    {"description": short, "full_description": full},
    headers={"Authorization": f"JWT {jwt}"},
)
print(f"   HTTP {status}")
print(f"   description={updated.get('description')!r}")
print(f"   full_description_len={len(updated.get('full_description') or '')}")
print(f"   https://hub.docker.com/r/{namespace}/{repo}")
print("✓ Docker Hub overview updated")
PY
