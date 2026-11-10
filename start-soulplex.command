#!/bin/bash
# Start Soulplex locally: rebuild the frontend, run the API and the worker, open the browser.
# Double-click this file in Finder (or run ./start-soulplex.command). Close the window to stop.
cd "$(dirname "$0")" || exit 1
set -e
if [ ! -d .venv ]; then echo "No .venv found. See README: Run without Docker."; read -r; exit 1; fi
# call the venv's Python directly: it works even if the project folder was moved after .venv was made
PY="$PWD/.venv/bin/python"
echo "== Checking Python packages"
"$PY" -m pip install -q -r backend/requirements.txt
echo "== Building the frontend"
cd frontend
[ -d node_modules ] || npm ci --ignore-scripts
npm run build --silent
cd ../backend
echo "== Starting the worker (dates run here)"
"$PY" -m app.worker &
WORKER=$!
trap 'kill $WORKER 2>/dev/null' EXIT
( sleep 4; open "http://localhost:8000" ) &
echo "== Soulplex is running at http://localhost:8000  (close this window or press Ctrl+C to stop)"
"$PY" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --no-access-log
