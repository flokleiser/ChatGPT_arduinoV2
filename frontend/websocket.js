window.user = '';
window.assistant = '';
window.error = '';
window.system = '';
window.userComplete = false;

// run connectToWebSocket on page load
window.addEventListener('load', () => {
    connectToWebSocket();
    addVolumeControl();
});

function updateDialogContent(querySelectorID, text, complete) {
    // upate div class user and assistant
    const div = document.querySelector(querySelectorID);

    div.innerHTML = text;
    if (complete) {
        div.classList.add('complete');
    } else {
        div.classList.remove('complete');
    }

    clearTimeout(parseInt(div.dataset.fadeTimeout));
    div.classList.remove('fade-out');

    // Set new timeout for fade-out
    const timeoutId = setTimeout(() => {
        div.classList.add('fade-out');
    }, 5000);

    div.dataset.fadeTimeout = timeoutId;

}
function connectToWebSocket() {
    // if no connection, try again after 2 seconds
    ws = new WebSocket('ws://localhost:3000');
    // if the server is not runnning, attempt again
    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            console.log(data);
            if (data.backEnd) {
                if (data.backEnd.messageType == "assistant") {
                    window.assistant = data.backEnd.message;
                    updateDialogContent(".assistant", window.assistant);
                }

                if (data.backEnd.messageType == "system") {
                    window.system = data.backEnd.message;
                    updateDialogContent(".system", window.system);
                }
                if (data.backEnd.messageType == "error") {
                    window.error = data.backEnd.message;
                    console.log(data.backEnd.message)
                    updateDialogContent(".error", window.error);
                }

                if (data.backEnd.messageType == "user") {
                    window.user = data.backEnd.message;
                    if (typeof data.backEnd.complete === "boolean") {
                        console.log('messageInComplete:', data.backEnd.complete);
                        window.userComplete = data.backEnd.complete;
                    }
                    updateDialogContent(".user", window.user, window.userComplete);
                }
                if (data.backEnd.functionName) {
                    let returnValue = { frontEnd: { name: data.backEnd.functionName, value: undefined } };
                    console.log('Function call received:', data.functionName);
                    // Call the function with the provided arguments
                    const functionName = data.backEnd.functionName;
                    const args = data.backEnd.arguments;
                    const func = frontendFunctions[functionName];
                    console.log('Looking up function:', functionName, frontendFunctions);

                    if (typeof func === 'function') {
                        console.log(`Calling function ${functionName} with arguments:`, args);
                        // If args is an array, spread it; if it's an object, pass as is
                        if (Array.isArray(args)) {
                            try {
                                returnValue.frontEnd.value = func(...args);
                            } catch (error) {
                                returnValue.frontEnd.value = "Error: " + error.message;
                            }
                        } else {
                            try {
                                returnValue.frontEnd.value = func(args);
                            } catch (error) {
                                returnValue.frontEnd.value = "Error: " + error.message;
                            }
                        }
                    } else {
                        console.error(`Function ${functionName} is not defined in frontendFunctions.js.`);
                    }
                    console.log('Sending return value:', returnValue);
                    ws.send(JSON.stringify(returnValue));
                }
            }
        } catch (e) {
            console.error('WebSocket parse error:', e);
        }
        // send return value back to server
    };
    // Handle connection close and retry
    ws.onclose = () => {
        console.warn("WebSocket connection closed. Retrying in .5 second...");
        setTimeout(connectToWebSocket, 500);
    };

    // Handle connection errors
    ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        ws.close(); // Close the connection to trigger retry
    };

};

function addVolumeControl() {
    let currentVolume = 50; // Default volume
    let volumeControl = null;
    let timeout = null;
    let isDragging = false;
    let startX = 0;
    let startVolume = 0;

    // Handle mouse down events
    document.addEventListener('mousedown', (event) => {
        // Use left-click for volume control
        if (event.button === 0) {

            startX = event.clientX;
            startVolume = currentVolume;
            isDragging = true;

            // Remove existing volume control if any
            if (volumeControl) {
                document.body.removeChild(volumeControl);
                document.body.removeChild(volume_text);
                document.body.removeChild(volume_bar);
               clearTimeout(timeout);
            }

            // Create volume indicator
            volumeControl = document.createElement('div');
            volumeControl.className = 'volume_slider';

            // Position directly under cursor
            volumeControl.style.left = `${event.clientX - 10}px`;
            volumeControl.style.top = `${event.clientY - 10}px`;

            // Display current volume


            document.body.appendChild(volumeControl);

            let volumPosition = (currentVolume / 100) * 300; // Assuming the slider width is 300px
            volume_bar = document.createElement('div');
            volume_bar.className = 'volume-bar';
            volume_bar.style.left = `${event.clientX - volumPosition}px`;
            volume_bar.style.top = `${event.clientY - 10}px`;
            document.body.appendChild(volume_bar);

            volume_text = document.createElement('div');
            volume_text.className = 'volume-label';
            volume_text.style.left = `${event.clientX - volumPosition}px`;
            volume_text.style.top = `${event.clientY + 40}px`;
            volume_text.textContent = `Volume: ${currentVolume}%`;
            document.body.appendChild(volume_text);
        }
    });

    // Handle mouse move for dragging
    document.addEventListener('mousemove', (event) => {
        if (isDragging && volumeControl) {
            // Calculate volume change based on horizontal movement
            const deltaX = event.clientX - startX;
            const volumeChange = Math.floor(deltaX / 3); // Adjust sensitivity here

            // Update volume (keep between 0-100)
            currentVolume = Math.max(0, Math.min(100, startVolume + volumeChange));

            // Update volume display
            volume_text.textContent = `Volume: ${currentVolume}%`;

            // Update position to follow mouse horizontally
            if (currentVolume > 0 && currentVolume < 100) {
                volumeControl.style.left = `${event.clientX - 20}px`;
            }
            // Send volume update to server
            ws.send(JSON.stringify({ command: 'setVolume', value: currentVolume }));
        }
    });

    // Handle mouse up to end dragging
    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;

            // Hide volume control after a short delay
          timeout =  setTimeout(() => {
                if (volumeControl && volumeControl.parentNode) {
                    document.body.removeChild(volumeControl);
                    document.body.removeChild(volume_text);
                    document.body.removeChild(volume_bar);
                    volumeControl = null;
                }
            }, 1000);
        }
    });

}

// Simple version - just shows offline status
function simpleConnectionCheck() {
    function showOfflineMessage() {
        if (!navigator.onLine) {
            const msg = document.createElement('div');
            msg.style.cssText = `
                position: fixed; top: 50%; left: 50%; transform: translateX(-50%);
                background: #f44336; color: white; padding: 10px 20px;
                border-radius: 4px; z-index: 9999; font-weight: bold;
            `;
            msg.textContent = 'No Internet Connection';
            document.body.appendChild(msg);
            
            // Remove when back online
            const removeMsg = () => {
                if (navigator.onLine && msg.parentNode) {
                    document.body.removeChild(msg);
                    window.removeEventListener('online', removeMsg);
                }
            };
            window.addEventListener('online', removeMsg);
        }
    }
    
    window.addEventListener('offline', showOfflineMessage);
    if (!navigator.onLine) showOfflineMessage(); // Check on load
}

// Call this when page loads
window.addEventListener('DOMContentLoaded', simpleConnectionCheck);