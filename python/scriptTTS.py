import sys
import json
import numpy as np
import sounddevice as sd
from piper.voice import PiperVoice
import threading
import os

# List of available models
MODEL_PATHS = [
    "./TTSmodels/en_GB-cori-high.onnx",
    "./TTSmodels/en_GB-alan-medium.onnx",
    "./TTSmodels/en_US-lessac-medium.onnx",
    "./TTSmodels/de_DE-thorsten-medium.onnx",
]

playback_thread = None
stop_event = threading.Event()
pause_event = threading.Event()
voice_cache = {}
outPut_Device = None

def get_voice(model_path):
    if model_path not in voice_cache:
        voice_cache[model_path] = PiperVoice.load(model_path)
    return voice_cache[model_path]

def send_message(name, string):
    msg = {f"{name}": f"{string}"}
    print(json.dumps(msg))
    sys.stdout.flush()

def play_stream(voice, text, stop_event, pause_event, device=None):
    try:
        send_message("tts", "started")
        
        # Get device info to check channels
        device_channels = 1
        if device is not None:
            try:
                device_info = sd.query_devices(device)
                device_channels = device_info['max_output_channels']
                print(f"Device {device} has {device_channels} output channels", file=sys.stderr)
            except Exception as e:
                print(f"Error querying device {device}: {e}", file=sys.stderr)
        
        # Set up the output stream with proper error handling for device
        try:
            # Try with specified device first
            if device is not None:
                stream = sd.OutputStream(
                    samplerate=voice.config.sample_rate, 
                    channels=device_channels,  # Use the device's channel count
                    dtype='int16',
                    device=device
                )
            else:
                # Fall back to default device if none specified
                stream = sd.OutputStream(
                    samplerate=voice.config.sample_rate, 
                    channels=1, 
                    dtype='int16'
                )
        except Exception as e:
            print(f"Error with specified device, falling back to default: {e}", file=sys.stderr)
            # Final fallback - try with default device
            stream = sd.OutputStream(
                samplerate=voice.config.sample_rate, 
                channels=1, 
                dtype='int16'
            )
            
        stream.start()
        for audio_bytes in voice.synthesize_stream_raw(text):
            if stop_event.is_set():
                break
            while pause_event.is_set():
                sd.sleep(100)
                if stop_event.is_set():
                    break
            int_data = np.frombuffer(audio_bytes, dtype=np.int16)
            
            # If device has multiple channels, duplicate the mono audio
            if device_channels > 1:
                # Duplicate mono audio to match channel count (e.g., stereo)
                int_data = np.repeat(int_data.reshape(-1, 1), device_channels, axis=1)
            
            stream.write(int_data)
        stream.stop()
        stream.close()
        send_message("tts", "stopped")
    except Exception as e:
        print(f"Audio playback error: {e}", file=sys.stderr)
        send_message("tts", f"error: {e}")

def handle_command(cmd):
    global pause_event
    if cmd == "pause":
        pause_event.set()
        print(f"pausing", file=sys.stderr)
    elif cmd == "resume":
        pause_event.clear()
        send_message("tts", "resumed")

def main():
    global playback_thread, stop_event, pause_event, outPut_Device
    
    

    outPut_Device = find_respeaker_device()
    
    print("Ready for text input...", file=sys.stderr)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            # Try to parse as JSON
            try:
                msg = json.loads(line)
            except Exception:
                msg = {}

            # Handle pause/resume commands
            if isinstance(msg, dict) and "tts" in msg:
                handle_command(msg["tts"])
                continue

            # Otherwise, treat as TTS request
            text = msg.get("text", "") if isinstance(msg, dict) else line
            model_no = int(msg.get("model", 0)) if isinstance(msg, dict) else 0

            if not text:
                continue
            if not (0 <= model_no < len(MODEL_PATHS)):
                print(f"Invalid model number: {model_no}", file=sys.stderr)
                continue
            model_path = MODEL_PATHS[model_no]
            if not os.path.isfile(model_path):
                print(f"Model file not found: {model_path}", file=sys.stderr)
                continue

            voice = get_voice(model_path)
            print(f"Synthesizing: {text} (model: {model_path})", file=sys.stderr)

            # Interrupt current playback if running
            if playback_thread and playback_thread.is_alive():
                stop_event.set()
                playback_thread.join()
            stop_event = threading.Event()
            pause_event.clear()
            playback_thread = threading.Thread(
                target=play_stream, 
                args=(voice, text, stop_event, pause_event, outPut_Device)
            )
            playback_thread.start()
        except Exception as e:
            print(f"Error: {e}", file=sys.stderr)
            send_message("tts", f"error: {e}")


    # Function to find ReSpeaker device
def find_respeaker_device():
    
        # List available audio devices at startup
        try:
            devices = sd.query_devices()
            for i, device in enumerate(devices):
                print(f"{i}: {device['name']} (in: {device['max_input_channels']}, out: {device['max_output_channels']})", file=sys.stderr)
        except Exception as e:
                print(f"Error listing audio devices: {e}", file=sys.stderr)
        try:
            devices = sd.query_devices()
            for i, device in enumerate(devices):
                device_name = str(device['name']).lower()
                if 'respeaker' in device_name and device['max_output_channels'] > 0:
                    print(f"Found ReSpeaker output device: {device['name']} with {device['max_output_channels']} channels", file=sys.stderr)
                    return i
            print("No ReSpeaker output device found, using default", file=sys.stderr)
            return None
        except Exception as e:
            print(f"Error finding audio devices: {e}", file=sys.stderr)
        return None

def get_voice(model_path):
        if model_path not in voice_cache:
            voice_cache[model_path] = PiperVoice.load(model_path)
        return voice_cache[model_path]

def send_message(name, string):
        msg = {f"{name}": f"{string}"}
        print(json.dumps(msg))
        sys.stdout.flush()

if __name__ == "__main__":
    main()