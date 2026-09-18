#!/usr/bin/env bash
set -euo pipefail

# Usage: ./scripts/deploy-subgraph.sh [network] [version-label]
#
#   network        base-sepolia (default) | localhost
#   version-label  passed to `graph deploy`; prompted for when omitted
#

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

NETWORK="${1:-base-sepolia}"
VERSION_LABEL="${2:-}"

CONFIG="config/${NETWORK}.json"
if [[ ! -f "$CONFIG" ]]; then
  echo "Unknown network '${NETWORK}'. Expected a config at ${CONFIG}." >&2
  echo "Available:" >&2
  ls config/*.json | sed 's|config/|  |; s|\.json||' >&2
  exit 1
fi

echo "==> Target: ${NETWORK} (${CONFIG})"
if command -v python3 >/dev/null 2>&1; then
  python3 -c "
import json,sys
cfg=json.load(open('${CONFIG}'))
for k,v in cfg.items():
    if isinstance(v,dict):
        print(f'      {k:26} {v[\"address\"]}  from block {v[\"startBlock\"]}')
"
fi

echo "==> Cleaning generated artifacts"
bun run clean

echo "==> Rendering subgraph.yaml for ${NETWORK}"
bun run "prepare:${NETWORK}"

echo "==> Running code generation"
bun run codegen

echo "==> Building subgraph"
bun run build

if [[ "$NETWORK" == "localhost" ]]; then
  echo "==> Registering subgraph on the local node"
  bun run create-local

  echo "==> Deploying to the local node"
  if [[ -n "$VERSION_LABEL" ]]; then
    graph deploy --node http://localhost:8020/ --ipfs http://localhost:5001 \
      --version-label "$VERSION_LABEL" payment-processor-indexer
  else
    bun run deploy-local
  fi
else
  echo "==> Deploying to The Graph Studio"
  if [[ -n "$VERSION_LABEL" ]]; then
    graph deploy --node https://api.studio.thegraph.com/deploy/ \
      --version-label "$VERSION_LABEL" payment-processor-indexer
  else
    bun run deploy
  fi
fi

echo "==> Done"
