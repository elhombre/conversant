#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/../.."

corepack prepare yarn@4.9.4 --activate
YARN_NODE_LINKER=node-modules corepack yarn install --immutable
PRISMA_CLI_BINARY_TARGETS=rhel-openssl-3.0.x YARN_NODE_LINKER=node-modules corepack yarn workspace @conversant/backend-data prisma:generate
