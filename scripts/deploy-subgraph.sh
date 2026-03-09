#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "==> Cleaning generated artifacts"
rm -rf build generated

echo "==> Running code generation"
bun run codegen

echo "==> Building subgraph"
bun run build

echo "==> Deploying subgraph"
bun run deploy

echo "==> Done"
