// Add voice option in config

import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import ChatGPTAPI from './Components/ChatGPTAPI.js';
// import config json file
//import { loadConfig, loadUsbConfig } from './Components/configHandler.js';
import { loadConfig, loadFromUSB, getUSBDetector } from './Components/configHandler.js';
import SerialCommunication from './Components/SerialCommunication.js';
import ICommunicationMethod from './Components/ICommunicationMethod.js';
import FunctionHandler from './Components/FunctionHandler.js';
//import BLECommunication from './Components/BLECommunication.js';
import SpeechToText from './Components/SpeechToText.js';
import TextToSpeech from './Components/TextToSpeech.js';
import { captureAndSendImage } from "./Components/camera.js";
import WiFiManager from './Components/WiFiManager.js';
//import USBConfigWatcher from './Components/USBConfigWatcher.js';

// Instance tracking for restarts
let currentInstances = {
  server: null,
  wss: null,
  usbWatcher: null,
  wifiManager: null,
  communicationMethod: null,
  speechToText: null,
  app: null
};

let isRestarting = false;
let config = null;
let ttsvolume = 50;

let existingConfig = null; // this is used for comparison on usb config change

const PORT = process.env.PORT || 3000;

async function main() {
  if (isRestarting) return; // Don't start if we're in the middle of restarting

  try {
    console.log('🚀 Starting ChatGPT Arduino application...');

    // Clear any existing instances
    if (currentInstances.server || currentInstances.wss) {
      await cleanup(false);
    }

    // Create new Express app and HTTP server
    currentInstances.app = express();
    currentInstances.server = http.createServer(currentInstances.app);
    currentInstances.wss = new WebSocketServer({ server: currentInstances.server });

    // 0. Load configuration
    config = await loadConfig(existingConfig);
    console.log('✅ Configuration loaded');
    // 0.1. Initialize USB Config Watcher
    currentInstances.usbWatcher = getUSBDetector();
    // Start watching for USB config changes

    currentInstances.usbWatcher.start();
    // Handle config changes 
    currentInstances.usbWatcher.on('configFound', async (event) => {
      console.log(`🔄 USB config detected and loaded: ${event.configPath}`);
      let newConfig = await loadFromUSB(event.configPath);
      if (JSON.stringify(newConfig) !== JSON.stringify(config)) {
        console.log('🔃 Config change, reloading config and restarting application with new configuration...');
        existingConfig = newConfig;
        // Restart internally instead of restarting the process
        await cleanup(true);
      } else {
        //attempt to eject the USB drive
        let configPath = event.configPath
        console.log('⚠️  configPath:', configPath);
        currentInstances.usbWatcher.ejectUSBDrive(configPath);
      }
    });



    //currentInstances.usbWatcher.eject()

    // 0.2. Initialize WiFi if configured
    if (config.wifi) {
      console.log('📶 WiFi configuration found, attempting to connect...');
      currentInstances.wifiManager = new WiFiManager();

      // Check if already connected
      const connectionStatus = await currentInstances.wifiManager.getConnectionStatus();
      if (!connectionStatus.connected) {
        console.log('Not connected to WiFi, attempting connection...');
        const result = await currentInstances.wifiManager.connectFromConfig(config.wifi);
        if (result.success) {
          console.log('✅ WiFi connected successfully:', result.message);
          // Get connection info
          const info = await currentInstances.wifiManager.getConnectionInfo();
          console.log(`📡 Connected to: ${info.ssid}, IP: ${info.ip}`);
        } else {
          console.log('❌ WiFi connection failed:', result.message);
        }
      } else {
        console.log('✅ Already connected to WiFi');
        const info = await currentInstances.wifiManager.getConnectionInfo();
        console.log(`📡 Current connection: ${info.ssid}, IP: ${info.ip}`);
      }
    } else {
      console.log('No WiFi configuration found in config.js');
    }

     // 1. Initialize communication method based on config
    console.log('📡 Initializing communication...');
    if (config.communicationMethod == "BLE") {
      console.log("BLE communication not yet implemented");
      currentInstances.communicationMethod = new ICommunicationMethod(comCallback);
    } else if (config.communicationMethod == "Serial") {
      currentInstances.communicationMethod = new SerialCommunication(comCallback);
    } else {
      currentInstances.communicationMethod = new ICommunicationMethod(comCallback);
    }



    // Setup function handler
    const functionHandler = new FunctionHandler(config, currentInstances.communicationMethod);

    // Setup LLM API
    console.log("model config:", config.chatGPTSettings.model);
    
    let LLM_API = new ChatGPTAPI(config, functionHandler);


    // Define callback functions first
    function comCallback(message) {
      console.log("com callback");
      console.log(message);
      // pass messages directly from the arduino to to LLM API
      LLM_API.send(message, "system").then((response) => {
        LLMresponseHandler(response);
      });
    }

    function callBackSpeechToText(msg) {
      let complete = false;
      if (msg.confirmedText) {
        console.log('stt:', msg.confirmedText);
        complete = true;
        msg.speech = msg.confirmedText
        // parse message to LLM API
        LLM_API.send(msg.confirmedText, "user").then((response) => {
          LLMresponseHandler(response);
        });
      } else if (msg.interimResult) {
        console.log('interim stt:', msg.interimResult);
        complete = false;
        msg.speech = msg.interimResult
      } else {
        msg.speech = "";
      }
      try {
        updateFrontend(msg.speech, "user", complete);
      } catch (e) {
        console.error('Error speech to text response', msg, e);
      }
    }

   
    // 2. Initialize speech to text
    console.log('🎤 Initializing speech to text...');
    currentInstances.speechToText = new SpeechToText(callBackSpeechToText);

    // 3. Setup Express middleware
    currentInstances.app.use(cors());
    currentInstances.app.use(express.json());
    currentInstances.app.use(express.static('frontend'));

    // 4. Setup WebSocket handling
    currentInstances.wss.on('connection', (ws, req) => {
      const ip = req.socket.remoteAddress;
      if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') {
        ws.close();
        console.log(`Rejected connection from non-local address: ${ip}`);
        return;
      }
      console.log(`Accepted WebSocket connection from ${ip}`);
      const lastAssistantMessage = config.conversationProtocol
        .filter(msg => msg.role === "assistant")
        .pop();

      if (lastAssistantMessage) {
        const initialState = {
          backEnd: {
            messageOut: lastAssistantMessage.content,
            messageInComplete: true  // Assume complete since it's history
          }
        };
        ws.send(JSON.stringify(initialState));
      }

      ws.on('message', async (message) => {
        try {

          // Try to parse as JSON, or treat as plain text
          let cmd;
          try {
            cmd = JSON.parse(message);
          } catch {
            cmd = { text: message.toString().trim() };
          }
          console.log('Received command via WebSocket:', cmd);

          if (cmd.command === 'pause') {
            currentInstances.speechToText.pause();
          } else if (cmd.command === 'resume') {
            currentInstances.speechToText.resume();
            ws.send('Sent resume command to Python');
          } else if (cmd.command === 'setVolume') {
            // convert string to number
            ttsvolume = parseInt(cmd.value, 10);
          } else if (cmd.command === 'restart-app') {
            console.log('🔄 Manual restart requested via WebSocket');
            ws.send(JSON.stringify({
              type: 'restart-initiated',
              message: 'Application restarting...'
            }));
            await cleanup(true);
          } else if (cmd.command === 'config-status') {
            ws.send(JSON.stringify({
              type: 'config-status',
              config: config,
              timestamp: new Date().toISOString()
            }));
          } else if (cmd.command === 'wifi-status') {
            // Get WiFi connection status
            const status = await currentInstances.wifiManager.getConnectionStatus();
            const info = await currentInstances.wifiManager.getConnectionInfo();
            ws.send(JSON.stringify({
              command: 'wifi-status',
              status: status,
              info: info
            }));
          } else if (cmd.command === 'wifi-scan') {
            // Scan for available networks  
            const networks = await currentInstances.wifiManager.scanNetworks();
            ws.send(JSON.stringify({
              command: 'wifi-scan',
              networks: networks
            }));
          } else if (cmd.command === 'wifi-connect') {
            // Connect to WiFi with provided credentials
            const result = await currentInstances.wifiManager.connectFromConfig(cmd.wifi);
            ws.send(JSON.stringify({
              command: 'wifi-connect',
              result: result
            }));
          } else if (cmd.text) {
            LLM_API.send(cmd.text, "user").then((response) => {
              LLMresponseHandler(response);
            });
            ws.send('Sent message to LLM API');
          } else if (cmd.command === 'protocol') {
            // Send the conversation protocol to the client
            ws.send(JSON.stringify(config.conversationProtocol))
          } else if (cmd.command === 'reload-config') {
            // Manually trigger config reload
            console.log('🔄 Manual config reload requested via WebSocket');
            await cleanup(true);
          } else {
            // ws.send('Unknown command');
          }
        } catch (err) {
          ws.send('Error handling command: ' + err.message);
        }
      });

      ws.on('close', () => {
        console.log('👋 WebSocket connection closed');
      });
    });

    // 5. Setup helper functions
    function broadcastUpdate(data) {
      currentInstances.wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(data);
        }
      });
    }

    function updateFrontend(message, messageType, complete) {
      const dataObj = {};
      dataObj.backEnd = {};
      if (typeof message !== 'undefined') dataObj.backEnd.message = message;
      if (typeof messageType !== 'undefined') dataObj.backEnd.messageType = messageType;
      if (typeof complete !== 'undefined') dataObj.backEnd.complete = complete;
      const data = JSON.stringify(dataObj);
      console.log(data);
      broadcastUpdate(data);
    }

    function frontEndFunction(functionName, args) {
      console.log("frontEndFunction called with functionName:", functionName, "and args:", args);
      const dataObj = {};
      dataObj.backEnd = {};
      if (typeof functionName !== 'undefined') dataObj.backEnd.functionName = functionName;
      if (typeof args !== 'undefined') dataObj.backEnd.args = args;
      const data = JSON.stringify(dataObj);
      broadcastUpdate(data);
    }


    // test the LLM API
    /*
    LLM_API.send("Tell me the time", "user").then((response) => {
      LLMresponseHandler(response);
    })
    */

    function LLMresponseHandler(returnObject) {

      // TODO: add error handling
      console.log(returnObject);
      if (returnObject.role == "assistant") {
        // convert the returnObject.message to string to avoid the class having access to the returnObject
        let message = returnObject.message.toString();
        try {
          updateFrontend(message, "assistant");
          console.log("Text to speech volume: " + ttsvolume);
          textToSpeech.say(message, config.voice, ttsvolume);
        } catch (error) {
          console.log(error);
          updateFrontend(error, "error");
        }
      } else if (returnObject.role == "function") {
        // call the frontend function with the arguments
        const functionName = returnObject.message;
        const args = returnObject.arguments;
        frontEndFunction(functionName, args);
        updateFrontend(functionName, "system");

      } else if (returnObject.role == "functionReturnValue") {
        // pass message to LLM API
        LLM_API.send(returnObject.value, "system").then((response) => {
          LLMresponseHandler(response);
        })
        updateFrontend(returnObject.value, "system");
      } else if (returnObject.role == "error") {
        updateFrontend(returnObject.message, "error");
      } else if (returnObject.role == "system") {
        // handle notifications from the device   
        updateFrontend(returnObject.message, "system");
      }
      if (returnObject.promise != null) {
        console.log("there is a promise")
        // there is another nested promise 
        // TODO: protect against endless recursion
        returnObject.promise.then((returnObject) => {
          LLMresponseHandler(returnObject)
        })
      } else {
        endExchange()
      }
    }

    function endExchange() {
      // todo: setup timer for continous interaction 
    }

    // 8. Setup Text to Speech
    let textToSpeech = new TextToSpeech(callBackTextToSpeech);

    function callBackTextToSpeech(msg) {
      if (msg.tts == "started" || msg.tts == "resumed") {
        console.log("pausing speech to text");
        currentInstances.speechToText.pause();
      } else if (msg.tts == "stopped" || msg.tts == "paused") {
        currentInstances.speechToText.resume();
      }
    }

    // 9. Start the server
    currentInstances.server.listen(PORT, () => {
      console.log(`🌐 Server running on http://localhost:${PORT}`);
      console.log('✅ Application started successfully');
    });

  } catch (error) {
    console.error('❌ Failed to start application:', error);
    await cleanup(false);
    throw error;
  }
}

async function cleanup(restart = false) {
  if (isRestarting && restart) return; // Prevent multiple restarts

  console.log(`🧹 Cleaning up resources... (restart: ${restart})`);

  try {
    // Stop USB watcher
      if (currentInstances.usbWatcher) {
      console.log('🛑 Stopping USB config watcher...');
      
      // Remove all event listeners to prevent scope issues
      currentInstances.usbWatcher.removeAllListeners();
      
      // Stop the watcher
      currentInstances.usbWatcher.stop();
      currentInstances.usbWatcher = null;
    }

    // Stop speech to text
    if (currentInstances.speechToText) {
      console.log('🛑 Pausing speech to text...');
      currentInstances.speechToText.pause();
      currentInstances.speechToText = null;
    }

    // Close communication method
    if (currentInstances.communicationMethod) {
      console.log('🛑 Closing communication method...');
      await currentInstances.communicationMethod.close();
      currentInstances.communicationMethod = null;
    }

    // Close WebSocket server first (disconnect all clients)
    if (currentInstances.wss) {
      console.log('🛑 Closing WebSocket server...');

      // Disconnect all clients first
      currentInstances.wss.clients.forEach((ws) => {
        if (ws.readyState === ws.OPEN) {
          ws.close();
        }
      });

      // Close the WebSocket server
      currentInstances.wss.close();
      currentInstances.wss = null;
    }

      // Close HTTP server with better error handling
    if (currentInstances.server) {
      console.log('🛑 Closing HTTP server...');

      // Check if server is actually listening before trying to close
      if (currentInstances.server.listening) {
        await new Promise((resolve) => {
          const timeout = setTimeout(() => {
            console.log('⚠️ HTTP server close timeout, forcing shutdown...');
            if (currentInstances.server && currentInstances.server.destroy) {
              currentInstances.server.destroy();
            }
            resolve();
          }, 3000);

          currentInstances.server.close((err) => {
            clearTimeout(timeout);
            if (err) {
              console.log('⚠️ Error closing HTTP server:', err.message);
            } else {
              console.log('✅ HTTP server closed');
            }
            resolve();
          });
        });
      } else {
        console.log('ℹ️ HTTP server was not running');
      }

      currentInstances.server = null;
    }

    console.log('✅ Cleanup completed');

    if (restart) {
      isRestarting = true;
      console.log('🔄 Restarting application...');
      setTimeout(async () => {
        try {
          isRestarting = false;
          await main();
          console.log('✅ Application restarted successfully');
        } catch (error) {
          console.error('❌ Failed to restart application:', error);
          isRestarting = false;
        }
      }, 1000);
    }

  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    if (!restart) {
      process.exit(1);
    } else {
      // Even if cleanup fails, try to restart
      isRestarting = true;
      setTimeout(async () => {
        try {
          await main();
          isRestarting = false;
          console.log('✅ Application restarted successfully after cleanup error');
        } catch (error) {
          console.error('❌ Failed to restart application after cleanup error:', error);
          isRestarting = false;
        }
      }, 2000);
    }
  }
}

// Start the application
main().catch((error) => {
  console.error('💥 Fatal error during startup:', error);
  process.exit(1);
});

// Signal handlers for graceful shutdown only (no restart)
process.on('SIGINT', async () => {
  console.log('\n🛑 Received SIGINT (Ctrl+C)...');
  await cleanup(false);
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Received SIGTERM...');
  await cleanup(false);
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', async (error) => {
  console.error('💥 Uncaught Exception:', error);
  await cleanup(false);
  process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  await cleanup(false);
  process.exit(1);
});

