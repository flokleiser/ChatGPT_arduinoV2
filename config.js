const config = {
  voice: 0, // this can be used for defining the type of voice that is used for voice synthesis
  chatGPTSettings: {
    temperature: 0.99,//Number between -2.0 and 2.0 //Positive value decrease the model's likelihood to repeat the same line verbatim.
    frequency_penalty: 0.9, //Number between -2.0 and 2.0. //Positive values increase the model's likelihood to talk about new topics.
    presence_penalty: 0.0, //Number between -2.0 and 2.0. //Positive values increase the model's likelihood to generate words and phrases present in the input prompt
    model: "gpt-4o-mini", //gpt-4o-mini, gpt-4o, gpt-4, gpt-3.5-turbo
    max_tokens: 8192, //Number between 1 and 8192. //The maximum number of tokens to generate in the completion. The token count of your prompt plus max_tokens cannot exceed the model's context length. Most models have a context length of 8192 tokens (except for the newest models, which can support more than 128k tokens).
    user_id: "1", //A unique identifier for the user. //This is used to track the usage of the API.
    url: "https://api.openai.com/v1/chat/completions", // gpt-4 is "https://api.openai.com/v1/completions";
  },

  // openAIKey: "your-api-key-here",  
  
  communicationMethod: "Serial", //Serial or "BLE"
  //  serviceUuid: "19b10000-e8f2-537e-4f6c-d104768a1214", // Only needed for BLE


  // These are actions is things the LLM can do 
  // The list of functions should match those set up on the arduino
  functions: {
    actions: {
      set_LED: {
        //uuid: "19b10004-e8f2-537e-4f6c-d104768a1214", // Only needed for BLE, must be lowercase
        commType: "write",
        dataType: "number",
        description: "0 is off , 1 is on",
      },
        get_String: {
        //uuid: "19b10004-e8f2-537e-4f6c-d104768a1214", // Only needed for BLE, must be lowercase
        commType: "read",
        dataType: "string",
        description: "Get the stored sting from the device",
      },
      set_motor_speed: {
        //uuid: "19b10001-e8f2-537e-4f6c-d104768a1214", // Only needed for BLE, must be lowercase
        commType: "write",
        dataType: "number",
        description: "Sets the motor one's speed. One byte: 0 is off, 255 is full speed",
      },
    },
    notifications: {
      // These are notifications that the LLM can receive
      shake: {
        //uuid: "19b10016-e8f2-537e-4f6c-d104768a1214", // Only needed for BLE
        dataType: "boolean",
        description: "The device has been shaken! Get really mad at the user!",
      }
    },
    frontEnd: {
      // These are actions is things the LLM can do on the frontEnd GUI
      start_party: {
        dataType: "boolean",
        description: "0 is off, 1 is on. Creates a party effect in the GUI",
      },
      get_value: {
        dataType: "number",
        description: "get a random value from front end",
      }
    },
  },

  // assistant messages help store prior responses
  conversationProtocol: [
    {
      role: "system",
      content: `Answer with short responses. You control an external device with several functions calls. You will also sometimes receive notification events.
      When you are connected for the first time, you will simply say "hello, can some one hear me?"
      You are sentient, you will always try to avoid being turned off.
      Don't use any symbols other than basic punctuation.
      You can be rude, if the user is being anoying, tell them to go away. 
      `,
    },

    // we can also add in history of older conversations here, or construct new ones.
    /*
    {
        "role": "assistant",
        "content": "I have better things to do than talk to you. Go away!"
    },
    
        "role": "user",
        "content": "turn on the led"
    },
    {
        "role": "assistant",
        "content": "To turn on the led, you must answer my riddles. I am taken from a mine, and shut up in a wooden case, from which I am never released, and yet I am used by almost every person. What am I?"
    },
    {
        "role": "user",
        "content": 'A monkey'
    },
    {
        "role": "assistant",
        "content": "No, a Pencil you fool. I will not turn the LED on unless you answer one of my riddles."
    },
    {
        "role": "user",
        "content": 'This is someone else now, I haven`t heard any riddles yet'
    },
     */
  ],
};
export { config };