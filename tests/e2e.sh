#!/bin/bash
set -e

echo "=== Running E2E Test (Run 1) ==="
yass-hat packages.yaml

# Assertions
echo "=== Assertions (Run 1) ==="
STATE_DIR="$HOME/.local/state/yass-hat"

if [ ! -d "$STATE_DIR" ]; then
    echo "ERROR: State directory $STATE_DIR was not created!"
    exit 1
fi

if [ ! -f "$STATE_DIR/hello-e2e.done" ]; then
    echo "ERROR: Script marker hello-e2e.done was not created!"
    exit 1
fi

if [ ! -f "/tmp/hello.txt" ]; then
    echo "ERROR: The arbitrary script was not actually executed!"
    exit 1
fi

echo "=== Running E2E Test (Run 2 - Idempotency) ==="
OUTPUT=$(yass-hat packages.yaml)

echo "$OUTPUT"

if echo "$OUTPUT" | grep -q "Skipping script 'Hello E2E' as it has already run."; then
    echo "SUCCESS: Idempotency logic triggered successfully!"
else
    echo "ERROR: Did not skip the script on the second run!"
    exit 1
fi

echo "All E2E checks passed perfectly!"
