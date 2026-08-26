#!/bin/sh
# hn.sh: make an owner-authenticated request to a Hypernormal installation.
#
# Reads the owner key from $HN_KEY if set, else from the file .owner-key in the
# repo root (gitignored; never paste the key on the command line where a shell
# history or a process list would keep it). Sends it as Authorization: Bearer.
#
# Config (env):
#   HN_BASE  base URL of the installation  (default: http://localhost:8787)
#   HN_KEY   the owner key itself, overriding the .owner-key file
#
# Usage:
#   scripts/hn.sh METHOD PATH [JSON_BODY]
#   JSON_BODY is optional: a raw JSON string ('{"k":"v"}') or @file to read a file.
#
# Examples:
#   scripts/hn.sh GET  /apps
#   scripts/hn.sh POST /apps @charter.json
#   scripts/hn.sh PUT  /a/<id> '{"law":{"visibility":"public","allowedHosts":[]}}'
#   scripts/hn.sh POST /a/<id>/rpc/bump '{}'
#
# Prints the response body followed by a status line: "HTTP <code>".
set -eu

HN_BASE="${HN_BASE:-http://localhost:8787}"

# Resolve this script's directory, then default the key file to its parent
# (the repo root), the same layout as the ancestor project's fw.sh.
_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
_repo_root=$(dirname -- "$_dir")
_key_file="$_repo_root/.owner-key"

usage() {
  cat <<'EOF'
hn.sh: owner-authenticated request to a Hypernormal installation.

Usage: hn.sh <METHOD> <PATH> [JSON_BODY]
  JSON_BODY is optional: a raw JSON string ('{"k":"v"}') or @file to read a file.

Auth: Authorization: Bearer <owner key>, taken from $HN_KEY if set, else from
the file .owner-key in the repo root (gitignored, one line, no trailing junk).

Env: HN_BASE (default http://localhost:8787), HN_KEY.

Examples:
  hn.sh GET  /apps
  hn.sh POST /apps @charter.json
  hn.sh PUT  /a/<id> '{"law":{"visibility":"public","allowedHosts":[]}}'
  hn.sh POST /a/<id>/rpc/bump '{}'
EOF
}

case "${1:-}" in
  -h|--help|"") usage; [ "${1:-}" = "" ] && exit 2 || exit 0 ;;
esac

if [ "$#" -lt 2 ]; then
  echo "hn.sh: need <METHOD> <PATH>. Try 'hn.sh --help'." >&2
  exit 2
fi

method="$1"
path="$2"
body="${3:-}"

if [ -n "${HN_KEY:-}" ]; then
  key="$HN_KEY"
elif [ -f "$_key_file" ]; then
  key=$(cat "$_key_file")
else
  echo "hn.sh: no owner key found. Either:" >&2
  echo "  export HN_KEY=<your owner key>" >&2
  echo "  or write it to $_key_file (one line, gitignored)" >&2
  exit 2
fi

set -- -H "Authorization: Bearer $key"

# Body: pass through to curl. A leading '@' makes curl read a file.
if [ -n "$body" ]; then
  set -- "$@" -H "Content-Type: application/json" --data-binary "$body"
fi

exec curl -sS -X "$method" "$@" -w '\nHTTP %{http_code}\n' "$HN_BASE$path"
