#!/usr/bin/env bash
# CI: start fake Texas and the example server on 127.0.0.1, run mcp-compliance, stop both by PID.
# usage: scripts/compliance.sh [mcp-compliance binary]
# Without a binary: start both, wait for health, leave them running (CI runs the Action next).
set -euo pipefail
bin=${1:-}
pids=(); out=$(mktemp)
trap 'kill "${pids[@]}" 2>/dev/null || true' EXIT

node scripts/fake-texas.mjs & pids+=($!)
NAIS_TOKEN_INTROSPECTION_ENDPOINT=http://127.0.0.1:8099/introspect \
NAIS_TOKEN_EXCHANGE_ENDPOINT=http://127.0.0.1:8099/exchange \
NAIS_CLUSTER_NAME=ci \
AZURE_APP_PRE_AUTHORIZED_APPS='[{"name":"ci:copilot:fleet-gateway","clientId":"ci-gateway"}]' \
PORT=8098 pnpm start & pids+=($!)

for _ in $(seq 60); do curl -fs http://127.0.0.1:8098/health >/dev/null && break; sleep 1; done
curl -fs http://127.0.0.1:8098/health >/dev/null
[ -n "$bin" ] || { trap - EXIT; exit 0; }

MCP_COMPLIANCE_TOKEN=ci-user-token MCP_COMPLIANCE_APP_TOKEN=ci-app-token \
  "$bin" -url http://127.0.0.1:8098/ | tee "$out"
! grep -q FAIL "$out"
