#!/bin/bash
set -m

# Set log file location
LOG_FILE="$(dirname "$0")/logs/kiosk.log"
mkdir -p "$(dirname "$LOG_FILE")"

# Function for logging
log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Redirect all stdout and stderr to log file while still showing on console
exec > >(tee -a "$LOG_FILE") 2>&1

log "Starting application"

# Change to the directory where this script is located
cd "$(dirname "$0")"

# Activate Python virtual environment
source python/venv/bin/activate

# Function to clean up on exit
cleanup() {
  echo "Shutting down servers and cleaning up..."

  # Kill any process using port 3000 or 5173
  echo "Killing processes on ports 3000 and 5173..."
  lsof -ti tcp:3000 | xargs kill -9 2>/dev/null
  lsof -ti tcp:5173 | xargs kill -9 2>/dev/null
  sleep 2


  # Kill backend/frontend (npm) and python scripts
  if [[ -n "$NPM_PID" ]]; then
    kill "$NPM_PID" 2>/dev/null
    wait "$NPM_PID" 2>/dev/null
  fi
  if [[ -n "$PY_PID" ]]; then
    kill "$PY_PID" 2>/dev/null
    wait "$PY_PID" 2>/dev/null
  fi

  # Try to kill Chromium by PID
  if [[ -n "$CHROMIUM_PID" ]]; then
    kill "$CHROMIUM_PID" 2>/dev/null
    sleep 2
    if ps -p "$CHROMIUM_PID" > /dev/null; then
      kill -9 "$CHROMIUM_PID" 2>/dev/null
    fi
  fi

  # Fallback: kill any chromium-browser processes
  pkill -f chromium-browser 2>/dev/null
  pkill -f "Google Chrome" 2>/dev/null
  pkill -o chromium 2>/dev/null

  # Kill any process using port 3000 or 5173
  lsof -ti tcp:3000 | xargs kill -9 2>/dev/null
  lsof -ti tcp:5173 | xargs kill -9 2>/dev/null

  echo "Cleanup complete."
}

# Trap EXIT and INT (Ctrl+C)
trap cleanup EXIT SIGINT SIGTERM

# Run cleanup at the start to clear old processes
cleanup

if lsof -ti tcp:3000 >/dev/null || lsof -ti tcp:5173 >/dev/null; then
  echo "Ports 3000 or 5173 are still in use. Exiting..."
  exit 1
fi


# Setup WiFi permissions only on Raspberry Pi (Linux)
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
  echo "Setting up WiFi management permissions for Raspberry Pi..."
  
  # Check if we need to add the sudoers rule
  if ! sudo -n grep -q "pi ALL=(ALL) NOPASSWD: /usr/bin/nmcli" /etc/sudoers.d/nmcli-pi 2>/dev/null; then
    echo "Adding WiFi management permissions..."
    echo "pi ALL=(ALL) NOPASSWD: /usr/bin/nmcli" | sudo tee /etc/sudoers.d/nmcli-pi > /dev/null
    sudo chmod 0440 /etc/sudoers.d/nmcli-pi
    echo "WiFi permissions configured."
  else
    echo "WiFi permissions already configured."
  fi
elif [[ "$OSTYPE" == "darwin"* ]]; then
  echo "Running on macOS - WiFi management not required."
else
  echo "Unknown OS type: $OSTYPE - skipping WiFi setup."
fi


# Start backend/frontend servers in the background
echo "Starting backend and frontend servers..."
npm start &
NPM_PID=$!

# Start your Python script(s) in the background (example)
python python/scriptTTS.py &
PY_PID=$!

# Wait for the frontend server to be ready
echo "Waiting for frontend server to be ready on http://localhost:5173 ..."
until curl -s http://localhost:5173 > /dev/null; do
  sleep 2
done

# Launch Chromium in kiosk mode on the attached display
if [[ "$OSTYPE" == "darwin"* ]]; then
  echo "Launching default browser on macOS..." &
  open http://localhost:5173 &
else
echo "Launching Chromium in kiosk mode..."
  sleep 5  # Extra wait for desktop to finish loading
 chromium-browser --no-sandbox --kiosk --disable-infobars --disable-restore-session-state http://localhost:5173 &
CHROMIUM_PID=$!
fi

# Wait for background jobs (so trap works)
wait
echo "All processes exited. Goodbye!"