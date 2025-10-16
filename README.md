#  ChatGPT_arduinoV2 

This project makes it easy to connect physical devices to a large language model, for prototyping so called "Large Language Objects". The project is essentially a voice assistant optimised for running on a raspberry pi with an attached Arduino. The code has been tested on Linux and Mac OS, and is optimised for Raspbery PI. 

After following the installation instructions, create an .env file with the openAI api key in the following format, or add it to the config.js file on an external usb stick. 

 ```bash
OPENAI_API_KEY='******************************' 
  ```

---

## 🚀 Quick Start: Setting Up on a New Raspberry Pi

### 1. **Prepare the SD Card**
- Flash the latest Raspberry Pi OS (Desktop) to your SD card using [Raspberry Pi Imager](https://www.raspberrypi.com/software/).
- **Enable SSH in imager**  

### 2. **First Boot**
- Insert the SD card into the Raspberry Pi and power it on.
- Connect via SSH:  
  ```bash
  ssh <username>@<devicename>.local
  ```
 
  
IMPORTANT: Enable Serial Interface

  ```bash
  sudo raspi-config
  ```

In config select "Interfacing Options" > "Serial". 

"Would you like a login shell to be accessible over serial?" > NO
"Would you like the serial port hardware to be enabled?" > Yes



### **Clone the Repository**
```bash
git clone https://github.com/IAD-ZHDK/ChatGPT_arduinoV2.git
cd ChatGPT_arduinoV2
```   

### **Get latest version after installing**

Navigate to the path of the project and run this line
```bash
git pull
```  

## Quick start

You can attempt to do the setup with the shell script setup-and-run. If this fails, then attempt the manuel process 

```bash
chmod +x setup-and-run.sh
./setup-and-run.sh
```

## Manual Setup

### 1. **Install Dependencies**
- Update the system and install Node.js, npm, and Chromium:

```bash
sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
# For Raspberry Pi OS Bookworm (newer)
sudo apt install -y nodejs chromium git
# For Raspberry Pi OS Bullseye and earlier
sudo apt install -y nodejs chromium-browser git
sudo apt-get install libusb-1.0-0-dev
sudo apt install portaudio19-dev
sudo apt install fswebcam
```

On macOS:
```bash
  brew install nodejs
  brew install libusb
  ```

### 2. **Install Project Dependencies**

```bash
cd ChatGPT_arduinoV2
npm install
```

### 3. Create and activate a Python virtual environment and install packages

```bash
python3 -m venv python/venv
source python/venv/bin/activate

pip3 install vosk numpy piper pyusb sounddevice requests  
pip3 install --no-deps -r python/requirements.txt
pip3 install onnxruntime pyaudio webrtcvad 

```

### 4. setup .env file

```bash
nano .env
```
and replace the API Key with your own. 
 ```bash
OPENAI_API_KEY='******************************' 
  ```

### 5. **Start the Application**

- Make sure python virtual environment is started:

```bash
  source python/venv/bin/activate
```
- To start both backend and frontend together:
```bash
  npm start
```
or for development:

```bash
  npm run dev
```

- The backend will run on port 3000, and the frontend on port 5173.

### 6. **Set Up Kiosk Mode and autostart**

```bash
chmod +x run.sh
./run.sh
```

### Debuging with terminal 

- Install wscat for terminal websocket connections
```bash
  npm install -g wscat
```
- Open a websocket connection
```bash
  wscat -c ws://localhost:3000
```

- Type a command to pause speech detection, or send text directly to the LLM
```bash
{"command":"pause"}
{"command":"sendMessage","message":"Hello from the terminal!"}
```

###  AutoStart

Add  /.config/autostart/chatgpt-arduino.desktop with the following content:

```bash
  [Desktop Entry]
  Type=Application
  Name=ChatGPT_arduinoV2
  Comment=Start ChatGPT_arduinoV2 Kiosk
  Exec=/home/pi/ChatGPT_arduinoV2/run.sh
  Path=/home/pi/ChatGPT_arduinoV2/
  Icon=utilities-terminal
  Terminal=false
```

### setup wifi WPA2 enterprise
```bash
   sudo nmcli connection add con-name "wlan-ZHDK" type wifi ifname wlan0 ssid "YOUR_SSID" wifi-sec.key-mgmt wpa-eap 802-1x.eap peap 802-1x.phase2-auth mschapv2 802-1x.identity "YOUR_USERNAME" 802-1x.password "YOUR_PASSWORD" ipv4.method auto connection.autoconnect yes
  
   sudo nmcli connection up "wlan-ZHDK"
  
   nmcli connection show
```
###  Todo

- Auto.restart when Arduino disconnected 
- Recent changes to Chatgpt API for images: fix needed
- Allow choice of vosk models via config file
- improve security (shh only over ethernet)
- add physical button to restart whole application 
- BLE integration 
