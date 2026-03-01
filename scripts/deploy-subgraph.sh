#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "==> Cleaning generated artifacts"
rm -rf build generated

echo "==> Running code generation"
npm run codegen

echo "==> Building subgraph"
npm run build

echo "==> Deploying subgraph"
npm run deploy

echo "==> Done"
