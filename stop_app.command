#!/bin/bash
# Stop the background TokenSense server started by start_background.command (or any server on port 5050).
cd "$(dirname "$0")"
if [ -f logs/server.pid ]; then
  kill "$(cat logs/server.pid)" 2>/dev/null
  rm -f logs/server.pid
fi
PIDS=$(lsof -t -nP -iTCP:5050 -sTCP:LISTEN 2>/dev/null)
[ -n "$PIDS" ] && kill $PIDS
echo "TokenSense stopped."
