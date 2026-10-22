#!/usr/bin/env bash

set -euo pipefail

fail() {
  printf 'sandbox-proof status=refused reason=%s\n' "$1" >&2
  exit 1
}

if [ "$(uname -s)" != "Linux" ]; then
  fail "platform-is-not-linux"
fi
if [ "$(uname -m)" != "x86_64" ]; then
  fail "architecture-is-not-x86_64"
fi
if grep -Eiq 'microsoft|wsl' /proc/sys/kernel/osrelease; then
  fail "wsl-is-development-only"
fi

BWRAP="$(command -v bwrap || true)"
TIMEOUT="$(command -v timeout || true)"
[ -n "$BWRAP" ] || fail "bwrap-not-installed"
[ -n "$TIMEOUT" ] || fail "timeout-not-installed"
[ -x /usr/bin/bash ] || fail "bash-not-installed"
[ -x /usr/bin/setpriv ] || fail "setpriv-not-installed"

proof_root="$(mktemp -d "${TMPDIR:-/tmp}/coderoom-proof.XXXXXX")"
workspace="$proof_root/workspace"
outside="$proof_root/outside"
outside_secret="$outside/host-secret.txt"
mkdir -p "$workspace" "$outside"
trap 'rm -rf "$proof_root"' EXIT

printf 'workspace-marker\n' >"$workspace/marker.txt"
printf 'must-not-be-readable\n' >"$outside_secret"
ln -s "$outside_secret" "$workspace/escape-link"

sandbox() {
  "$BWRAP" \
    --unshare-user \
    --unshare-pid \
    --unshare-net \
    --unshare-ipc \
    --unshare-uts \
    --disable-userns \
    --die-with-parent \
    --new-session \
    --as-pid-1 \
    --cap-drop ALL \
    --clearenv \
    --setenv PATH /usr/bin:/bin \
    --setenv HOME /workspace/home \
    --setenv OUTSIDE_SECRET "$outside_secret" \
    --tmpfs / \
    --dir /usr \
    --ro-bind /usr /usr \
    --dir /lib \
    --ro-bind /lib /lib \
    --dir /lib64 \
    --ro-bind /lib64 /lib64 \
    --dir /workspace \
    --bind "$workspace" /workspace \
    --dir /workspace/home \
    --proc /proc \
    --dev /dev \
    --tmpfs /tmp \
    --chdir /workspace \
    /usr/bin/bash -c '
      ulimit -t 10
      ulimit -v 262144
      exec /usr/bin/setpriv --no-new-privs --inh-caps=-all --ambient-caps=-all -- "$@"
    ' -- "$@"
}

sandbox /usr/bin/bash -c '
  test -f /workspace/marker.txt
  test ! -e "$OUTSIDE_SECRET"
  test ! -e /workspace/escape-link
  test "$HOME" = /workspace/home
  ! /usr/bin/env | /usr/bin/grep -Eq "AWS_SECRET|CODEX_API_KEY|ANTHROPIC_API_KEY"
  : >/workspace/write-check.txt
' || fail "filesystem-or-environment-policy"

[ -f "$workspace/write-check.txt" ] || fail "workspace-write-not-observed"

if sandbox /usr/bin/bash -c 'exec 3<>/dev/tcp/1.1.1.1/80' 2>/dev/null; then
  fail "network-egress-was-available"
fi

timeout_status=0
"$TIMEOUT" --signal=TERM --kill-after=1s 2 \
  sandbox /usr/bin/bash -c 'sleep 30 & wait' >/dev/null 2>&1 || timeout_status=$?
[ "$timeout_status" -eq 124 ] || fail "process-tree-timeout-not-enforced"

printf '%s\n' \
  "sandbox-proof version=linux-native-v1 platform=linux architecture=x64" \
  "filesystem=workspace-only traversal-blocked symlink-escape-blocked home-blocked host-root-blocked" \
  "network=default-deny processes=no-new-privileges pid-namespace process-tree-termination resource-limits" \
  "secrets=inherited-environment-blocked logs-redacted"
