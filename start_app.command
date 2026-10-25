#!/bin/bash
# Double-click in Finder to start TokenSense. Keep this window open; press Ctrl+C to stop.
cd "$(dirname "$0")"

if [ ! -x .venv/bin/python ]; then
  echo "Setting up Python environment (first run only)..."
  python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt
fi

(for i in $(seq 1 30); do
  sleep 1
  curl -s -o /dev/null http://127.0.0.1:5050/ && open "http://127.0.0.1:5050" && break
done) &

echo "Starting TokenSense at http://127.0.0.1:5050 ..."
.venv/bin/python app.py
