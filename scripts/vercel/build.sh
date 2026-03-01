#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/../.."

YARN_NODE_LINKER=node-modules corepack yarn workspace frontend build
node scripts/vercel/copy-prisma-engine.mjs
