#  ChatGPT_arduinoV2 

This project makes it easy to connect physical devies to a large language model, for prototyping so called "Large Language Objects". The project is essentially a voice assistant optimised for running on a raspberry pi with an attached arduino. The code has been tested on Linux and Mac OS. 

After following the installation instructions, create an .env file with the openAI api key in the following format, or add it to the config.js file. 

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

Allow the device to reboot. 
 
  
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


## Quick start

You can attemp to do the setup with the shell sript setup-and-run. If this fails, then attempt the manuel process 

```bash
chmod +x setup-and-run.sh
./setup-and-run.sh
```

## Manual Setup

### 1. **Install Dependencies**
- Update the system and install Node.js, npm, and Chromium etc:
  ```bash

  sudo apt update && sudo apt upgrade -y
  curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
  sudo apt install -y nodejs chromium-browser git
  sudo apt-get install libusb-1.0-0-dev


On macOS:
  brew install nodejs
  brew install libusb


### 2. **Install Project Dependencies**
```bash
cd ChatGPT_arduinoV2
npm install
```

### 3. Create and activate a Python virtual environment and install packages

python3 -m venv python/venv
source python/venv/bin/activate

pip3 install pyaudio vosk sounddevice numpy piper pyusb
pip3 install --no-deps -r python/requirements.txt
pip3 install onnxruntime  


### 4. **Start the Application**

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

- The backend will run on port 3000, and the frontend (Vite dev server) on port 5173.

### 5. **Set Up Kiosk Mode and autostart**

```bash
chmod +x runPi.sh
./runPi.sh
```

###  Debuging with terminal 

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

Add the .desktop file to /.config/autostart/ with the following content:

```bash
  Type=Application
  Name=Sentient Senses
  Comment=Start Sentient Senses Kiosk
  Exec=<path>run.sh
  Path=<path>
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

- audio out via respeaker lite
- respeaker lite voice active integration
- Autorestart when config changed or Arduino disconnected
- Pass all errors to frontend display
- Compete image integration 
- BLE integration 
- Seperate speaker audio device python script
- add simple way of downloading sst and tts models 
- improve security (shh only over ethernet)

