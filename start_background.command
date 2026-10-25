#!/bin/bash
# Start TokenSense in the background (survives closing Terminal) and keep the Mac awake while it runs.
# Stop it with stop_app.command.
cd "$(dirname "$0")"
mkdir -p logs

if lsof -nP -iTCP:5050 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "TokenSense is already running at http://127.0.0.1:5050"
  exit 0
fi

# caffeinate -is: no idle/system sleep while the server process is alive
nohup caffeinate -is .venv/bin/python app.py > logs/server.log 2>&1 < /dev/null &
echo $! > logs/server.pid
disown

for i in $(seq 1 30); do
  sleep 1
  if curl -s -o /dev/null http://127.0.0.1:5050/; then
    echo "TokenSense is running in the background at http://127.0.0.1:5050"
    echo "You can close this window. Use stop_app.command to stop it."
    open "http://127.0.0.1:5050"
    exit 0
  fi
done
echo "Server did not start, see logs/server.log"
