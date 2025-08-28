import fetch from 'node-fetch';
import 'dotenv/config';

/**
 * ChatGPTAPI class
 * Handles communication with OpenAI's API and function call routing.
 */
class ChatGPTAPI {
  constructor(config, functionHandler) {
    // Configuration and communication object
    this.config = config;
    this.functionHandler = functionHandler;
    // Use the API key in your app
    this.apiKey = this.getApiKey(this.config);
    // OpenAI API settings
    this.Url = config.chatGPTSettings.url;
    this.Model = config.chatGPTSettings.model;
    this.MaxTokens = config.chatGPTSettings.max_tokens;
    this.UserId = config.chatGPTSettings.user_id;

  }


  // Function to get API key from either .env or config.js
  getApiKey(config) {

    try {
      if (config.openAIKey) {
        console.log("Using API key from config.js");
        return config.openAIKey;
      } else {
        if (process.env.OPENAI_API_KEY) {
          console.log("Using API key from .env file");
          return process.env.OPENAI_API_KEY;
        }
      }
    } catch (err) {
      console.error("Error reading config file:", err);
    }

    // If not found anywhere, throw error
    throw new Error("OpenAI API key not found. Please provide it in .env file or config.js");
  }


  /**
   * Get the current model name
   */
  getModel() {
    return this.Model;
  }

  /**
   * Send a message to the OpenAI API and handle the response.
   * Optionally, handle function calls.
   */

  async send(sQuestion, role, functionName) {
    let timeStampMillis = Date.now();
    console.log("send to llm:" + role + " " + sQuestion + " function:" + functionName)
    
    // Check if input is camera image data
    let isImageData = false;
    let imageData = null;
    
    if (typeof sQuestion === 'string' && sQuestion.startsWith('{"Camera Image":')) {
      console.log("📸 detected camera image data, parsing...");
      try {
        const parsedInput = JSON.parse(sQuestion);
        imageData = parsedInput["Camera Image"];
        isImageData = true;
        console.log("📸 sending image to chatGPT");
      } catch (e) {
        console.error("Error parsing camera image data:", e);
        isImageData = false;
      }
    }
    
    return new Promise((resolve, reject) => {
      (async () => {
        let messages;
        
        if (isImageData && imageData) {
          // Handle image data
          let base64Data;
          if (imageData.startsWith('data:image/')) {
            base64Data = imageData.replace(/^data:image\/\w+;base64,/, "");
          } else {
            base64Data = imageData;
          }
          
          // Validate base64 data
          if (!base64Data || base64Data.length < 100) {
            console.error("Base64 data too short or empty:", base64Data.length);
            resolve({ message: "Error: Invalid or empty image data", role: "error" });
            return;
          }
          
          messages = [...this.config.conversationProtocol, {
            role: role,
            content: [
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${base64Data}`,
                },
              },
            ],
          }];
        } else {
          // Handle text data
          messages = [...this.config.conversationProtocol];
          
          // Add message to conversation protocol for text only
          if (functionName) {
            messages.push({
              role: role,
              name: functionName,
              content: sQuestion,
            });
            this.config.conversationProtocol.push({
              role: role,
              name: functionName,
              content: sQuestion,
            });
          } else {
            messages.push({
              role: role,
              content: sQuestion,
            });
            this.config.conversationProtocol.push({
              role: role,
              content: sQuestion,
            });
          }
        }

        // Prepare API request data
        let data = {
          model: this.Model,
          max_tokens: this.MaxTokens,
          user: this.UserId,
          temperature: this.config.chatGPTSettings.temperature,
          frequency_penalty: this.config.chatGPTSettings.frequency_penalty,
          presence_penalty: this.config.chatGPTSettings.presence_penalty,
          stop: ["#", ";"],
          messages: messages,
        };
        
        // Only add functions for text requests, not image requests
        if (!isImageData) {
          data.functions = this.functionHandler.getAllFunctions();
        }

        // Prepare return object
        let returnObject = {
          message: null,
          promise: null,
          role: "assistant",
        };

        if (!sQuestion) {
          console.log("message content is empty!");
          return resolve(returnObject);
        }
        
        console.log("Send request to OpenAI API")
        try {
          // Send request to OpenAI API
          const response = await fetch(this.Url, {
            method: 'POST',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(data),
          });
          const duration = Date.now() - timeStampMillis;
          console.log(`✅ ChatGPT response received in ${duration}ms`);
          const oJson = await response.json();

          // console.log(oJson.choices[0].message,);

          // Handle API errors
          if (oJson.error && oJson.error.message) {
            console.log("Error from OpenAI API:", oJson.error.message);
            throw new Error("Error: " + oJson.error.message);
          } else if (oJson.choices[0].finish_reason === "function_call" && !isImageData) {
            // Handle function call (only for text requests, not image requests)
            let message = oJson.choices[0].message;
            // Await the function call handler and resolve with its result
            let result = await this.functionHandler.handleCall(
              message,
              returnObject
            );

            if (typeof result.value === 'string' && result.value.startsWith('{"Camera Image":')) {
              console.log("result from function call:", result.message);
            } else {
              console.log("result from function call:", result);
            }

            this.config.conversationProtocol.push({
              role: "function",
              name: message.function_call.name,
              content: message.function_call.arguments
            });

            // if the function call has a return value, pass it back to the LLM, otherwise just resolve the result
            if (result.description == 'response') {
              // description: 'response', value: newData }
              resolve(this.send(result.description, "function", result.value))
            } else {
              resolve(result);
            }

          } else {
            console.log(isImageData ? "image response" : "normal response");
            let currentTimeMillis = Date.now();
            console.log("response time (ms):", currentTimeMillis - timeStampMillis);
            // Handle normal response
            let sMessage = "";
            if (oJson.choices[0].text) {
              sMessage = oJson.choices[0].text;
            } else if (oJson.choices[0].message) {
              //GPT-4
              sMessage = oJson.choices[0].message.content;
            }

            if (!sMessage) {
              console.log("no response from OpenAI");
              sMessage = "No response";
            }

            returnObject.message = sMessage;
            // Always add the assistant's response to conversation protocol
            this.config.conversationProtocol.push({
              role: "assistant",
              content: sMessage,
            });
            resolve(returnObject);
          }
        } catch (e) {
          // Handle fetch or parsing errors
          returnObject.message = `Error fetching ${this.Url}: ${e.message}`;
          returnObject.role = "error";
          resolve(returnObject);
        }
      })();
    });
  }
}


export default ChatGPTAPI;