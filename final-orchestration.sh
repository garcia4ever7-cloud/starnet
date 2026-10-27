#!/bin/bash
set -e

# Set a known API token that both sidecar and orchestration will use
export API_TOKEN="orch-token-orchestration-run"
export SKYNET_DEV=1

echo "CHRISTIAN STORY STUDIO - ORCHESTRATION"
echo "======================================"
echo ""
echo "Starting sidecar with known token..."

# Start sidecar with the known token
npm run dev:seed:keep > /tmp/orch-sidecar.log 2>&1 &
SIDECAR_PID=$!
echo "Sidecar PID: $SIDECAR_PID"

# Wait for sidecar to be ready
echo "Waiting for sidecar to be ready..."
for i in {1..60}; do
  if curl -s http://127.0.0.1:8787/api/health > /dev/null 2>&1; then
    echo "✓ Sidecar ready"
    break
  fi
  sleep 1
done

sleep 2

# Run orchestration - it will use the same API_TOKEN from environment
echo ""
echo "Starting orchestration..."
node direct-orchestration.js

# Keep sidecar alive briefly for final processing
sleep 5

# Clean up
echo "Shutting down sidecar..."
kill $SIDECAR_PID 2>/dev/null || true
wait $SIDECAR_PID 2>/dev/null || true

echo "Done"
