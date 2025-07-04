// Add voice option in config

import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import ChatGPTAPI from './Components/ChatGPTAPI.js';
// import config json file
import { loadConfig } from './Components/configHandler.js';
import SerialCommunication from './Components/SerialCommunication.js';
import ICommunicationMethod from './Components/ICommunicationMethod.js';
import FunctionHandler from './Components/FunctionHandler.js';
//import BLECommunication from './Components/BLECommunication.js';
import SpeechToText from './Components/SpeechToText.js';
import TextToSpeech from './Components/TextToSpeech.js';
import { captureAndSendImage } from "./Components/camera.js";

let communicationMethod = null;
let speechToText = null;
let config = null;
let ttsvolume = 50;


const app = express();
const PORT = process.env.PORT || 3000;
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

async function main() {
  // 0. Load configuration


  config = await loadConfig();


  // 1. Start HTTP/WebSocket server
  app.use(cors()); // Configure middleware for Express.js server.
  app.use(express.json()); // Configure middleware for Express.js server.

  server.listen(PORT, () => {
    console.log(`Server and WebSocket running on port ${PORT}`);
  });

  // handle commands for debuging ect.
  wss.on('connection', (ws, req) => {
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

    ws.on('message', (message) => {
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
          speechToText.pause();
          ws.send('Sent pause command to Python');
        } else if (cmd.command === 'resume') {
          speechToText.resume();
          ws.send('Sent resume command to Python');
        } else if (cmd.command === 'setVolume') {
          // convert string to number
          ttsvolume = parseInt(cmd.value, 10);
        } else if (cmd.text) {
          LLM_API.send(cmd.text, "user").then((response) => {
            LLMresponseHandler(response);
          });
          ws.send('Sent message to LLM API');
        } else if (cmd.command === 'protocol') {
          // Send the conversation protocol to the client
          ws.send(JSON.stringify(config.conversationProtocol))
        } else {
          // ws.send('Unknown command');
        }
      } catch (err) {
        ws.send('Error handling command: ' + err.message);
      }
    });
  });


  // 2. setup speech to text
  speechToText = new SpeechToText(callBackSpeechToText);
  //speechToText.pause();

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
  // 2. setup comunication method for arduino

  function comCallback(message) {
    console.log("com callback");
    console.log(message);
    // pass messages directly from the arduino to to LLM API
    LLM_API.send(message, "user").then((response) => {
      LLMresponseHandler(response);
    });
  }

  // test
  // let serialTest = new SerialCommunication(comCallback);

  if (config.communicationMethod == "BLE") {
    console.log
  } else if (config.communicationMethod == "Serial") {
    communicationMethod = new SerialCommunication(comCallback);
  } else {
    communicationMethod = new ICommunicationMethod(comCallback);
  }

  function broadcastUpdate(data) {
    //   const data = JSON.stringify({ variable: textIn, messageINComplete: complete,  messageOut: textOut });
    wss.clients.forEach(client => {
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


  // setup function handler

  const functionHandler = new FunctionHandler(config, communicationMethod);

  // 4. setup LLM API

  let LLM_API = new ChatGPTAPI(config, functionHandler);

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
        textToSpeech.say(message, 0, ttsvolume);
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

  // 5. setup Text to Speech

  let textToSpeech = new TextToSpeech(callBackTextToSpeech);

  function callBackTextToSpeech(msg) {
    if (msg.tts == "started" || msg.tts == "resumed") {
      console.log("pausing speech to text");
      speechToText.pause();
    } else if (msg.tts == "stopped" || msg.tts == "paused") {
      speechToText.resume();
    } else {
      speechToText.resume();
    }
  }

  // test camera
  /*
    captureAndSendImage(config, functionHandler)
      .then(result => {
        console.log("Image captured and sent successfully:", result);
        // Do something with result
      })
      .catch(err => {
        console.error("Error capturing and sending image:", err);
        // Handle error
      });
  */
}

main();

