class ICommunicationMethod {
    constructor(callback, config) {
        this.callback = callback;
        this.config = config;
        this.connected = false;
    }
    connect() {
       console.trace("Method 'connect()' must be implemented.");
    }

    write(data) {
        console.trace("Method 'send(data)' must be implemented.");
    }

    read(data) {
        console.trace("Method 'read(data)' must be implemented.");
    }

    recieve() {
        console.trace("Method 'recieve()' must be implemented.");
    }

    onDisconnected() {
        console.trace("Method 'disconnect()' must be implemented.");
    }

    checkConection() {
        return new Promise((resolve, reject) => {
          let returnObject = {
            description: "Connected",
            value: this.connected,
          }
          resolve(returnObject);
        })
      }
    

    str2ab(str) {
        // converts string to array object
        var buf = new ArrayBuffer(str.length);
        var bufView = new Uint8Array(buf);
        for (var i=0, strLen=str.length; i < strLen; i++) {
        bufView[i] = str.charCodeAt(i);
        }
        return buf;
    };

     // Method to return the function itself if it exists
     getMethod(methodName) {
        return typeof this[methodName] === 'function' ? this[methodName] : null;
    }
    
}

export default ICommunicationMethod;