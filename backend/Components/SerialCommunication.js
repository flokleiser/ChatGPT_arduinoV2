import ICommunicationMethod from './ICommunicationMethod.js';
import { SerialPort, ReadlineParser } from 'serialport';

class SerialCommunication extends ICommunicationMethod {
  constructor(callback) {
    super(callback);
    this.connected = false;
    this.baudRate = 115200; // Corrected common baud rate
    this.port = null;
    this.parser = null;
    this.callback = callback;
    this.reconectInterval = null;

    this.connect();
  }

  connect() {
    // List available ports and connect to Arduino
    SerialPort.list().then((ports) => {
      const portObject = ports.find(
        (port) => port.manufacturer && port.manufacturer.includes('Arduino')
      );
      if (!portObject) {
        console.error('⚠️ ⚠️ No Arduino device found.');
        return;
      }
      this.port = new SerialPort({
        path: portObject.path,
        baudRate: this.baudRate,
        autoOpen: false,
      });

      this.parser = this.port.pipe(new ReadlineParser({ delimiter: '\n' }));

      this.port.on('open', () => {
        this.onConnect(portObject);
      });

      this.port.on('error', (err) => {
        this.connected = false;
        console.error('Serial port error:', err.message);
        if (this.callback) this.callback('error', err.message);
        console.log('attempting to reconnect');
        this.port.open((err) => {
          if (err) {
            console.error('Error opening port:', err.message);
          }
        });

      });

      this.port.on('close', () => {
        this.connected = false;
        console.log('Serial port closed');
        if (this.callback) this.callback('The arduino is disconnected');
        this.onDisconnected()
      });

      this.parser.on('data', (data) => {
        this.receive(data)
      })

      this.port.open((err) => {
        if (err) {
          console.error('Failed to open serial port:', err.message);
        }
      });
    });
  }

  checkConnection() {
    return this.connected;
  }

  write(data) {
    return new Promise((resolve, reject) => {
      if (!this.port || !this.port.isOpen) {
        return reject(new Error('Serial port not open, trying to reconnect'));
      }
      const dataToSend = "" + data.name + "" + data.value;
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

    return new Promise((resolve, reject) => {
      if (!this.port || !this.port.isOpen) {
        return reject(new Error('Serial port not open'));
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
        reject(new Error('Serial read timed out'));
      }, 3000); // 3 seconds timeout

      // Send the command to the serial device
      this.port.write(dataToSend + '\n', (err) => {
        if (err) {
          clearTimeout(timeoutId);
          this._pendingRead = null;
          return reject(err);
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
    }, 5000); // try to reconnect every 5 seconds
  }

  onConnect(portObject) {
    this.connected = true;
    console.log(`Serial port opened: ${portObject.path}`);
    if (this.callback) this.callback('The arduino is connected');
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
    const parts = newData.split(':');
    const commandName = parts[0];
    const value = parts[1].trimEnd();

    let updateObject = {
      description: commandName,
      value: value,
      // type: notifyObject.type,
    };

    // If there's a pending read promise, resolve it and return
    if (this._pendingRead) {
      console.log("open read promise found, resolving with data:", newData);
      const handler = this._pendingRead;
      this._pendingRead = null;
      handler(updateObject);
      return;
    }

    // Otherwise, treat as a regular event/notification
    if (parts.length === 2) {
      try {
        console.log(updateObject);
        if (this.callback) {
          this.callback(JSON.stringify(updateObject));
        }
      } catch (error) {
        console.log(error);
      }
    } else {
      // Handle unexpected format or just pass raw data
      if (this.callback) {
        this.callback(JSON.stringify({ description: "raw", value: newData }));
      }
    }
  }

}

export default SerialCommunication;