#!/bin/bash

# Exit on error
set -e

# Check if we're running as pi user
if [ "$USER" = "root" ]; then
    echo "Please run this script as the pi user, not root:"
    echo "Example: ./setup-and-run.sh"
    exit 1
fi

echo "Updating system..."
sudo apt update && sudo apt upgrade -y

echo "Installing required software..."

# Install Node.js, Chromium (Bookworm or Bullseye), Git and libusb
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
if sudo apt install -y nodejs chromium git libusb-1.0-0-dev; then
  echo "Installed chromium (Bookworm or newer)"
else
  echo "Trying alternative Chromium package name (Bullseye or older)..."
  sudo apt install -y nodejs chromium-browser git libusb-1.0-0-dev
fi

# Navigate to the project directory
cd "$(dirname "$0")"

echo "Installing project dependencies..."
# Install dependencies for the entire workspace
npm install

# Set up Python virtual environment and install packages
echo "Setting up Python environment and installing packages..."
python3 -m venv python/venv
source python/venv/bin/activate
pip3 install --no-deps -r python/requirements.txt


# TODO  install STT and TTS models

echo "Setting up autostart for kiosk mode..."
# Add Chromium kiosk mode to autostart
AUTOSTART_FILE="/etc/xdg/lxsession/LXDE-pi/autostart"
if ! grep -q "chromium-browser" "$AUTOSTART_FILE"; then
    echo "@chromium-browser --kiosk --disable-infobars --disable-restore-session-state http://localhost:5173" | sudo tee -a "$AUTOSTART_FILE"
fi

echo "Setting up application autostart..."
# Create autostart directory if it doesn't exist
mkdir -p ~/.config/autostart

# Create the desktop entry file
cat > ~/.config/autostart/chatgpt_arduino.desktop << EOL
[Desktop Entry]
Type=Application
Name=ChatGPT_arduinoV2
Comment=Start ChatGPT_arduinoV2 Kiosk
Exec=$HOME/ChatGPT_arduinoV2/run.sh
Path=$HOME/ChatGPT_arduinoV2/
Icon=utilities-terminal
Terminal=false
EOL

# Make run.sh executable if it isn't already
chmod +x run.sh

echo "Autostart configuration completed."

echo "Setting up backend and frontend to start on boot..."

# Detect the actual user (even if running with sudo)
ACTUAL_USER=${SUDO_USER:-$USER}
ACTUAL_HOME=$(eval echo ~$ACTUAL_USER)
AUTOSTART_DIR="$ACTUAL_HOME/.config/autostart"

# Create directory as the actual user
sudo -u "$ACTUAL_USER" mkdir -p "$AUTOSTART_DIR"

# Get absolute paths
PROJECT_PATH=$(pwd)
RUN_SCRIPT_PATH="$PROJECT_PATH/run.sh"

# Create the autostart .desktop file as the actual user
sudo -u "$ACTUAL_USER" tee "$AUTOSTART_DIR/chatgpt-arduino.desktop" > /dev/null << EOF
[Desktop Entry]
Type=Application
Name=ChatGPT_arduinoV2
Comment=Start ChatGPT_arduinoV2 Kiosk
Exec=$RUN_SCRIPT_PATH
Path=$PROJECT_PATH
Icon=utilities-terminal
Terminal=false
Categories=Application;
X-GNOME-Autostart-enabled=true
EOF

# Set proper permissions
sudo -u "$ACTUAL_USER" chmod 644 "$AUTOSTART_DIR/chatgpt-arduino.desktop"

echo "Making run.sh executable..."
chmod +x ./run.sh

echo "Installing wscat for debugging..."
npm install -g wscat

echo "Setup WPA2 Enterprise WiFi? (y/n)"
read setup_wifi

if [[ $setup_wifi == "y" ]]; then
  echo "Enter SSID:"
  read ssid
  echo "Enter username:"
  read username
  echo "Enter password:"
  read -s password
  
  sudo nmcli connection add con-name "wlan0-ZHDK" type wifi ifname wlan0 ssid "$ssid" \
    wifi-sec.key-mgmt wpa-eap 802-1x.eap peap 802-1x.phase2-auth mschapv2 \
    802-1x.identity "$username" 802-1x.password "$password" \
    ipv4.method auto connection.autoconnect yes
    
  sudo nmcli connection up "wlan0-ZHDK"
  nmcli connection show
fi

echo "Creating .env file for OpenAI API key..."
if [ ! -f .env ]; then
  echo "Enter your OpenAI API Key:"
  read -s api_key
  echo "OPENAI_API_KEY='$api_key'" > .env
fi

echo "Starting the project..."
# Start the project (run.sh will handle this part)
./run.sh &