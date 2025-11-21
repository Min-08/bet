#!/usr/bin/env bash
set -euo pipefail

UVICORN_CMD="uvicorn server.main:app --reload --host 0.0.0.0 --port 8000"

echo "Starting Virtual Probability Simulation server..."
echo "Command: ${UVICORN_CMD}"
exec ${UVICORN_CMD}
