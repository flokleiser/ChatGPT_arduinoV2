import ICommunicationMethod from './ICommunicationMethod.js';
import { SerialPort, ReadlineParser } from 'serialport';

class SerialCommunication extends ICommunicationMethod {
  constructor(callback, config) {
    super(callback, config);
    this.connected = false;
    this.baudRate = 115200; // Corrected common baud rate
    this.port = null;
    this.parser = null;
    this.callback = callback;
    this.reconectInterval = null;

    // Handle the connect promise to avoid unhandled rejection
    this.connect().catch((err) => {
      console.error('Failed to connect to serial device during initialization:', err.message);
      // Don't throw the error, just log it and continue
      // The reconnection logic will handle retrying
    });
  }

  connect() {
    return new Promise((resolve, reject) => {
      // Check if already connected
      if (this.connected && this.port && this.port.isOpen) {
        console.log('Already connected to serial device');
        return resolve({
          description: "Connection Status",
          value: "Already connected to serial device on " + this.port.path
        });
      }

      // List available ports and connect to serial device
      SerialPort.list().then((ports) => {
        const portObject = ports.find(
          (port) => port.manufacturer && port.manufacturer.includes('Arduino')
        );
        if (!portObject) {
          console.error('⚠️ ⚠️ No serial device device found.');
          return resolve({
            description: "Connection Status",
            value: "Error: No serial device found",
            error: true
          });
        }

        // Close existing port if it exists but isn't properly connected
        if (this.port && !this.port.isOpen) {
          try {
            this.port.removeAllListeners();
          } catch (e) {
            // Ignore errors when cleaning up
          }
        }

        this.port = new SerialPort({
          path: portObject.path,
          baudRate: this.baudRate,
          autoOpen: false,
        });

        this.parser = this.port.pipe(new ReadlineParser({ delimiter: '\n' }));

        this.port.on('open', () => {
          this.onConnect(portObject);
          // Resolve the promise when connection is successful
          resolve({
            description: "Connection Status",
            value: "Connected to serial device on " + portObject.path
          });
        });

        this.port.on('error', (err) => {
          this.connected = false;
          console.error('Serial port error:', err.message);
          if (this.callback) this.callback('error', err.message);
          resolve({
            description: "Connection Status",
            value: "Error: " + err.message,
            error: true
          });
        });

        this.port.on('close', () => {
          this.connected = false;
          console.log('Serial port closed');
          if (this.callback) this.callback('The serial device is disconnected');
          this.onDisconnected();
        });

        this.parser.on('data', (data) => {
          this.receive(data);
        });

        this.port.open((err) => {
          if (err) {
            console.error('Failed to open serial port:', err.message);
            resolve({
              description: "Connection Status",
              value: "Error: Failed to open serial port: " + err.message,
              error: true
            });
          }
        });
      }).catch((err) => {
        resolve({
          description: "Connection Status",
          value: "Error: Error listing serial ports: " + err.message,
          error: true
        });
      });
    });
  }

  checkConection() {
    return new Promise((resolve) => {
      resolve({
        description: "Connection Status",
        value: this.connected ? "Connected" : "Disconnected"
      });
    });
  }

  write(data) {
    return new Promise((resolve) => {
      if (!this.port || !this.port.isOpen) {
        return resolve({
          description: 'Writing to Serial',
          value: "Error: Serial port not open, trying to reconnect",
          error: true
        });
      }
      const dataToSend = "" + data.name + "" + data.value;
      console.log('Writing to serial:', dataToSend);
      this.port.write(dataToSend + '\n', (err) => {
        if (err) {
          console.error('Error writing to serial:', err.message);
          return resolve({
            description: 'Writing to Serial',
            value: "Error: " + err.message,
            error: true
          });
        }
        resolve({ description: 'Writing to Serial', value: dataToSend });
      });
    });
  }

  writeRaw(dataString) {
    return new Promise((resolve, reject) => {
      if (!this.port || !this.port.isOpen) {
        return reject(new Error('Serial port not open'));
      }
      const dataToSend = dataString;
      console.log('Writing to serial:', dataToSend);
      this.port.write(dataToSend + '\n', (err) => {
        if (err) {
          console.error('Error writing to serial:', err.message);
          return reject(err);
        }
        resolve({ description: 'Writing to Serial', value: dataToSend });
      });
    });
  }

  read(command = "") {
    const dataToSend = "" + command.name + ""
    console.log("waiting for read response on command:" + dataToSend);

    return new Promise((resolve) => {
      if (!this.port || !this.port.isOpen) {
        return resolve({
          description: 'response',
          value: "Error: Serial port not open",
          error: true
        });
      }

      // Set up a one-time handler for the next response
      let timeoutId;
      const onData = (newData) => {
        // Optionally, filter for the expected response here
        clearTimeout(timeoutId);
        this._pendingRead = null;
        this.callback(JSON.stringify(newData));
        console.log("read response received:", newData);
        resolve({ description: 'response', value: newData });
      };

      // Save the handler so receive() can use it
      this._pendingRead = onData;

      // Set up a timeout
      timeoutId = setTimeout(() => {
        this._pendingRead = null;
        resolve({
          description: 'response',
          value: "Error: Serial read timed out",
          error: true
        });
      }, 3000); // 3 seconds timeout

      // Send the command to the serial device
      this.port.write(dataToSend + '\n', (err) => {
        if (err) {
          clearTimeout(timeoutId);
          this._pendingRead = null;
          resolve({
            description: 'response',
            value: "Error: " + err.message,
            error: true
          });
        }
      });
    });
  }

  async close() {
    // close the port if it's open
    if (this.port && this.port.isOpen) {
      return new Promise((resolve, reject) => {
        this.port.close((err) => {
          if (err) {
            console.error('Error closing serial port:', err.message);
            return reject(err);
          }
          resolve();
        });
      });
    }
  }

  // Event handlers for compatibility
  onSerialErrorOccurred(error) {
    console.error('Serial error:', error);
  }

  onSerialConnectionOpened() {
    console.log('Serial connection opened');
  }

  onDisconnected() {
    console.log('Serial connection closed');

    this.reconectInterval = setInterval(() => {
      if (!this.connected) {
        console.log('Attempting to reconnect to serial port...');
        this.connect();
      } else {
        clearInterval(this.reconectInterval);
        this.reconectInterval = null;
      }
    }, 10000); // try to reconnect every 10 seconds
  }

  onConnect(portObject) {
    this.connected = true;
    console.log(`Serial port opened: ${portObject.path}`);
    if (this.callback) this.callback('The serial device is connected');
    // remove interval for reconnect if any exists
    if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval);
      this.reconnectInterval = null;
    }
  }


  receive(newData) {
    // data from serial could be either an event or a response to a prior command
    console.log("new serial communication");
    console.log(newData);

    // Add safety check for newData
    if (!newData || typeof newData !== 'string') {
      console.warn('Invalid serial data received:', newData);
      return;
    }

    const parts = newData.split(':');
    const commandName = parts[0];

    // Safety check for parts[1] before calling trimEnd()
    const value = parts.length > 1 && parts[1] ? parts[1].trimEnd() : '';
    console.log(this.config);
    let notifyObject = null;
    if (this.config &&
      this.config.functions &&
      this.config.functions.notifications &&
      this.config.functions.notifications[commandName]) {
      notifyObject = this.config.functions.notifications[commandName];
    }

    if (parts.length >= 2 && commandName && value) {
      let updateObject = {
        description: commandName,
        value: value,
      };
      // If there's a pending read promise, resolve it and return
      if (this._pendingRead) {
        this._pendingRead(updateObject);
        return;
      } else if (notifyObject != null) {
        // Otherwise, treat as a regular event/notification
        // check if commandName exists in notifications

        let updateObject = {
          description: notifyObject.info,
          value: notifyObject.value,
          type: notifyObject.type,
        }
        this.callback(JSON.stringify(updateObject));
      } else {
        // Handle malformed data
        console.warn('no pending read or notification found for: ', newData);
        /*
         this.callback(JSON.stringify({
           description: 'raw_data',
           value: newData
         }));
         */
      }
    } else {
      console.warn('Malformed serial data received:', newData);
    }
  }

}

export default SerialCommunication;