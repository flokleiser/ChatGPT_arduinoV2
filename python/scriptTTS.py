import sys
import json
import numpy as np
import sounddevice as sd
from piper.voice import PiperVoice
import threading
import os
import requests
import shutil
# Add to imports at the top of _vosk.py
from model_downloader import download_and_extract_model, check_model_exists, download_piper_voice

tts_volume = 100 
# List of available models

MODEL_PATH = "TTSmodels/"  # Default model path



# Dictionary mapping model names to their download URLs (model + config)
TTS_MODELS = {
    "en_GB-cori-high.onnx": {
        "model": "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_GB/cori/high/en_GB-cori-high.onnx",
        "config": "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_GB/cori/high/en_GB-cori-high.onnx.json"
    },
    "en_GB-alan-medium.onnx": {
        "model": "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_GB/alan/medium/en_GB-alan-medium.onnx",
        "config": "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_GB/alan/medium/en_GB-alan-medium.onnx.json"
    },
    "en_US-lessac-medium.onnx": {
        "model": "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx",
        "config": "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json"
    },
    "de_DE-thorsten-medium.onnx": {
        "model": "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx",
        "config": "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx.json"
    }
}

# List of available model names (for easy indexing)
MODEL_NAMES = list(TTS_MODELS.keys())
MODEL_DEFAULT = MODEL_NAMES[0]

playback_thread = None
stop_event = threading.Event()
pause_event = threading.Event()
voice_cache = {}
outPut_Device = None

def get_voice(model_name):
    """Get voice model, downloading if necessary"""
    model_base = os.path.splitext(os.path.basename(model_name))[0]  # Remove .onnx if present
    model_path = os.path.join(MODEL_PATH, model_name)
    
    if model_path not in voice_cache:
        # Check if model exists
        if not (os.path.exists(model_path) and os.path.exists(model_path + ".json")):
            print(f"Voice model '{model_path}' not found. Downloading...", file=sys.stderr)
            success = download_piper_voice(model_base, MODEL_PATH, 
                                           model_url=TTS_MODELS[model_name]['model'],
                                           config_url=TTS_MODELS[model_name]['config'])
            if not success:
                raise FileNotFoundError(f"Failed to download voice model: {model_base}")
        
        # Load the model
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
                device = None  # Fall back to default device
        
        # Set up the output stream with proper error handling
        try:
            # Create stream with the proper channel count
            stream = sd.OutputStream(
                samplerate=voice.config.sample_rate, 
                channels=device_channels,
                dtype='int16',
                device=device
            )
            print(f"Successfully opened stream with {device_channels} channels", file=sys.stderr)
            
            stream.start()
            
            for audio_bytes in voice.synthesize_stream_raw(text):
                if stop_event.is_set():
                    break
                while pause_event.is_set():
                    sd.sleep(100)
                    if stop_event.is_set():
                        break
                
                int_data = np.frombuffer(audio_bytes, dtype=np.int16)
                
                # Apply volume scaling if needed
                if tts_volume != 100:
                    float_data = int_data.astype(np.float32)
                    float_data = float_data * (tts_volume / 100.0)
                    int_data = np.clip(float_data, -32768, 32767).astype(np.int16)
                
                # If device has multiple channels, duplicate the mono audio
                if device_channels > 1:
                    # Reshape to column vector and duplicate across channels
                    int_data = np.repeat(int_data.reshape(-1, 1), device_channels, axis=1)
                
                stream.write(int_data)
            
            stream.stop()
            stream.close()
             # add 0.5 delay before sending stopped message
            sd.sleep(600)
            print(f"tts stopped", file=sys.stderr)
            send_message("tts", "stopped")
            
        except Exception as e:
            print(f"Stream error: {e}", file=sys.stderr)
            # Try with default device as last resort
            if device is not None:
                print("Falling back to default audio device", file=sys.stderr)
                play_stream(voice, text, stop_event, pause_event, None)
            else:
                raise
            
    except Exception as e:
        print(f"Audio playback error: {e}", file=sys.stderr)
        send_message("tts", f"error: {e}")

def set_tts_volume(volume_level):
    """
    Set the TTS output volume level (0-100)
    
    Args:
        volume_level (int): Volume level from 0 (mute) to 100 (max)
    Returns:
        int: New volume level, or None if invalid
    """
    global tts_volume
    
    if not 0 <= volume_level <= 100:
        print(f"Volume level must be between 0 and 100", file=sys.stderr)
        return None
    
    tts_volume = volume_level
    print(f"TTS output volume set to {tts_volume}%", file=sys.stderr)
    return tts_volume

def handle_command(cmd):
     global pause_event, tts_volume
    
     if isinstance(cmd, str):
        if cmd == "pause":
            pause_event.set()
            print("pausing", file=sys.stderr)
        elif cmd == "resume":
            pause_event.clear()
            send_message("tts", "resumed")
     elif isinstance(cmd, dict):
        if "volume" in cmd:
            try:
                new_volume = int(cmd["volume"])
                result = set_tts_volume(new_volume)
                if result is not None:
                    send_message("volume", str(result))
            except ValueError:
                print(f"Invalid volume value: {cmd['volume']}", file=sys.stderr)
        elif "volume_change" in cmd:
            try:
                change = int(cmd["volume_change"])
                new_volume = max(0, min(100, tts_volume + change))
                result = set_tts_volume(new_volume)
                if result is not None:
                    send_message("volume", str(result))
            except ValueError:
                print(f"Invalid volume change value: {cmd['volume_change']}", file=sys.stderr)
        elif "volume_get" in cmd:
            send_message("volume", str(tts_volume))

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

            # Handle commands
            if isinstance(msg, dict):
                if "tts" in msg:
                    handle_command(msg["tts"])
                    continue
                # Handle volume control commands
                if "volume" in msg or "volume_change" in msg or "volume_get" in msg:
                    handle_command(msg)
                    continue

            # Otherwise, treat as TTS request
            text = msg.get("text", "") if isinstance(msg, dict) else line
            model_no = int(msg.get("model", 0)) if isinstance(msg, dict) else 0
        

            if not text:
                continue
            if not (0 <= model_no < len(MODEL_NAMES)):
                print(f"Invalid model number: {model_no}", file=sys.stderr)
                model_no = 0
                continue
           
                
            model_name = MODEL_NAMES[model_no]
            print(f"Atempting to get voice", file=sys.stderr)
            voice = get_voice(model_name)
            print(f"Synthesizing: {text} (model: {model_name})", file=sys.stderr)

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


    
def ensure_tts_model_exists(model_path):
    """Ensures the specified TTS model exists, downloading it if necessary"""
    model_dir = os.path.dirname(model_path)
    model_name = os.path.basename(model_path)
    config_path = model_path + ".json"
    
    # If both files exist, we're good
    if os.path.exists(model_path) and os.path.exists(config_path):
        return True
    
    # Need to download one or both files
    print(f"TTS model '{model_name}' or its config not found. Downloading...", file=sys.stderr)
    os.makedirs(model_dir, exist_ok=True)
    
    if model_name not in TTS_MODELS:
        print(f"No download information for model: {model_name}", file=sys.stderr)
        return False
    
    try:
        # Download model file if needed
        if not os.path.exists(model_path):
            print(f"Downloading model file from {TTS_MODELS[model_name]['model']}", file=sys.stderr)
            model_response = requests.get(TTS_MODELS[model_name]['model'], stream=True)
            model_response.raise_for_status()
            
            with open(model_path, 'wb') as f:
                shutil.copyfileobj(model_response.raw, f)
            
            print(f"Model downloaded to {model_path}", file=sys.stderr)
        
        # Download config file if needed
        if not os.path.exists(config_path):
            print(f"Downloading config from {TTS_MODELS[model_name]['config']}", file=sys.stderr)
            config_response = requests.get(TTS_MODELS[model_name]['config'])
            config_response.raise_for_status()
            
            with open(config_path, 'wb') as f:
                f.write(config_response.content)
                
            print(f"Config downloaded to {config_path}", file=sys.stderr)
        
        # Verify files exist
        return os.path.exists(model_path) and os.path.exists(config_path)
    
    except Exception as e:
        print(f"Error downloading TTS model: {e}", file=sys.stderr)
        return False

def send_message(name, string):
        msg = {f"{name}": f"{string}"}
        print(json.dumps(msg))
        sys.stdout.flush()

if __name__ == "__main__":
    main()