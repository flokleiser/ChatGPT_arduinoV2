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
  async send(sQuestion, role, funtionName) {
    let timeStampMillis = Date.now();
    console.log("send to llm:" + role + " " + sQuestion + " function:" + funtionName)
    return new Promise((resolve, reject) => {
      (async () => {
        // Prepare API request data
        let data = {
          model: this.Model,
          max_tokens: this.MaxTokens,
          user: this.UserId,
          temperature: this.config.chatGPTSettings.temperature,
          frequency_penalty: this.config.chatGPTSettings.frequency_penalty,
          presence_penalty: this.config.chatGPTSettings.presence_penalty,
          stop: ["#", ";"],
          functions: this.functionHandler.getAllFunctions(),
          messages: this.config.conversationProtocol,
        };

        // Add message to conversation protocol
        if (funtionName) {
          this.config.conversationProtocol.push({
            role: role,
            name: funtionName,
            content: sQuestion,
          });
        } else {
          this.config.conversationProtocol.push({
            role: role,
            content: sQuestion,
          });
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
        console.log(`role: ${role} is sending message: ${sQuestion}`);

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

          const oJson = await response.json();

          // console.log(oJson.choices[0].message,);

          // Handle API errors
          if (oJson.error && oJson.error.message) {
            console.log("Error from OpenAI API:", oJson.error.message);
            throw new Error("Error: " + oJson.error.message);
          } else if (oJson.choices[0].finish_reason === "function_call") {
            // Handle function call
            // Add function call to conversation history
            let message = oJson.choices[0].message;
            console.log("function_call with function name:", message.function_call.name);
            // Await the function call handler and resolve with its result
            let result = await this.functionHandler.handleCall(
              message,
              returnObject
            );

            console.log("result from function call:", result);

            this.config.conversationProtocol.push({
              role: "function",
              name: message.function_call.name,
              content: message.function_call.arguments
            });
            // console.log(result);

            // if the function call has a return value, pass it back to the LLM, otherwise just resolve the result
            if (result.description == 'response') {
              // description: 'response', value: newData }
              resolve(this.send(result.description, "function", result.value))
            } else {
              resolve(result);
            }



          } else {
            console.log("normal response");
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


  /**
 * Send an image to OpenAI API and handle the response.
 * @param {string} image - base64-encoded image string (e.g., "data:image/png;base64,...")
 * @param {string} role - role for the message, usually "user"
 * @returns {Promise<{message: string, role: string}>}
 */
  async sendImage(image, role = "user") {
    // Remove data URL prefix if present
    const base64Data = image.replace(/^data:image\/\w+;base64,/, "");

    const messages = [
      {
        role: "system",
        content: "Describe the image. Be specific about the objects, people, colors. Only say a little about the context.",
      },
      {
        role: role,
        content: [
          {
            type: "image_url",
            image_url: {
              url: `data:image/png;base64,${base64Data}`,
            },
          },
        ],
      },
    ];

    const data = {
      model: this.Model, // Should be "gpt-4o" or "gpt-4-vision-preview"
      messages: messages,
      max_tokens: this.MaxTokens || 1024,
      user: this.UserId,
    };

    try {
      const response = await fetch(this.Url, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(data),
      });

      const oJson = await response.json();

      if (oJson.error && oJson.error.message) {
        console.log("Error from OpenAI API:", oJson.error.message);
        throw new Error("Error: " + oJson.error.message);
      }

      let sMessage = "";
      if (oJson.choices && oJson.choices[0].message) {
        sMessage = oJson.choices[0].message.content;
      }

      if (!sMessage) {
        sMessage = "No response";
      }

      // Optionally, add to conversation history
      this.config.conversationProtocol.push({
        role: "assistant",
        content: sMessage,
      });

      return { message: sMessage, role: "assistant" };
    } catch (e) {
      return { message: `Error fetching ${this.Url}: ${e.message}`, role: "error" };
    }
  }


}



export default ChatGPTAPI;