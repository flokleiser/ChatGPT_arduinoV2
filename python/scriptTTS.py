import sys
import json
import numpy as np
import sounddevice as sd
from piper.voice import PiperVoice
import threading
import queue
import os
from model_downloader import download_piper_voice

# Global variables
tts_volume = 100
MODEL_PATH = "TTSmodels/"
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

MODEL_NAMES = list(TTS_MODELS.keys())
playback_thread = None
stop_event = threading.Event()
pause_event = threading.Event()
voice_cache = {}
output_device = None

def send_message(name, string):
    """Send JSON message to stdout"""
    msg = {f"{name}": f"{string}"}
    print(json.dumps(msg))
    sys.stdout.flush()

def get_voice(model_name):
    """Get voice model, downloading if necessary"""
    model_path = os.path.join(MODEL_PATH, model_name)
    
    if model_path not in voice_cache:
        # Download if missing
        if not (os.path.exists(model_path) and os.path.exists(model_path + ".json")):
            model_base = os.path.splitext(os.path.basename(model_name))[0]
            success = download_piper_voice(model_base, MODEL_PATH, 
                                         model_url=TTS_MODELS[model_name]['model'],
                                         config_url=TTS_MODELS[model_name]['config'])
            if not success:
                raise FileNotFoundError(f"Failed to download voice model: {model_base}")
        
        # Load model
        voice_cache[model_path] = PiperVoice.load(model_path)
    
    return voice_cache[model_path]

def extract_audio_from_chunk(audio_chunk):
    """Extract audio bytes from AudioChunk object"""
    # Try audio_float_array first (most reliable)
    if hasattr(audio_chunk, 'audio_float_array') and audio_chunk.audio_float_array is not None:
        float_array = audio_chunk.audio_float_array
        if float_array.dtype != np.float32:
            float_array = float_array.astype(np.float32)
        int16_array = (float_array * 32767).astype(np.int16)
        return int16_array.tobytes()
    
    # Fallback to other attributes
    for attr in ['_audio_int16_bytes', '_audio_int16_array']:
        if hasattr(audio_chunk, attr):
            value = getattr(audio_chunk, attr)
            if value is not None:
                return value.tobytes() if hasattr(value, 'tobytes') else value
    
    return None

def get_supported_sample_rate(device=None):
    """Find a supported sample rate for the device"""
    # Common sample rates to try, in order of preference
    rates_to_try = [44100, 16000, 48000, 8000, 22050]
    
    for rate in rates_to_try:
        try:
            # Test if this rate works
            sd.check_output_settings(device=device, samplerate=rate, channels=1, dtype='int16')
            print(f"Using sample rate: {rate}Hz", file=sys.stderr)
            return rate
        except Exception as e:
            print(f"Sample rate {rate}Hz not supported: {e}", file=sys.stderr)
            continue
    
    # If nothing works, try the default
    print("No specific sample rate worked, trying default", file=sys.stderr)
    return None

import queue
import threading

def play_stream(voice, text, stop_event, pause_event, device=None):
    """Play TTS audio stream"""
    try:
        send_message("tts", "started")
        
        # Find a supported sample rate
        target_sample_rate = get_supported_sample_rate(device)
        
        if target_sample_rate is None:
            stream = sd.OutputStream(channels=1, dtype='int16', device=device)
            target_sample_rate = stream.samplerate
        else:
            stream = sd.OutputStream(
                samplerate=target_sample_rate, 
                channels=1,
                dtype='int16',
                device=device
            )
        
        stream.start()
        print(f"Audio stream started with {stream.samplerate}Hz", file=sys.stderr)
        
        # Get original sample rate for resampling
        original_rate = voice.config.sample_rate
        actual_target_rate = stream.samplerate
        
        # Calculate resampling ratio
        needs_resampling = original_rate != actual_target_rate
        if needs_resampling:
            ratio = actual_target_rate / original_rate
            print(f"Will resample from {original_rate}Hz to {actual_target_rate}Hz", file=sys.stderr)
        
        # Try different synthesis methods
        try:
            # Method 1: Generator without wav_file
            print("Trying generator synthesis...", file=sys.stderr)
            for audio_chunk in voice.synthesize(text):
                if stop_event.is_set():
                    break
                    
                chunk_data = extract_audio_from_chunk(audio_chunk)
                if not chunk_data:
                    continue
                
                # Process chunk immediately
                int_data = np.frombuffer(chunk_data, dtype=np.int16)
                
                # Resample this chunk if needed
                if needs_resampling and len(int_data) > 0:
                    old_indices = np.arange(len(int_data))
                    new_length = int(len(int_data) * ratio)
                    if new_length > 0:
                        new_indices = np.linspace(0, len(int_data) - 1, new_length)
                        int_data = np.interp(new_indices, old_indices, int_data).astype(np.int16)
                
                # Apply volume scaling
                if tts_volume != 100:
                    float_data = int_data.astype(np.float32)
                    float_data = float_data * (tts_volume / 100.0)
                    int_data = np.clip(float_data, -32768, 32767).astype(np.int16)
                
                # Play this chunk immediately
                if len(int_data) > 0:
                    # Handle pause/resume
                    while pause_event.is_set():
                        sd.sleep(100)
                        if stop_event.is_set():
                            break
                    
                    if stop_event.is_set():
                        break
                        
                    stream.write(int_data)
                    
        except TypeError as e:
            if "missing 1 required positional argument: 'wav_file'" in str(e):
                print("Trying generator with wav_file=None...", file=sys.stderr)
                for audio_chunk in voice.synthesize(text, wav_file=None):
                    # Same processing as above...
                    if stop_event.is_set():
                        break
                        
                    chunk_data = extract_audio_from_chunk(audio_chunk)
                    if not chunk_data:
                        continue
                    
                    int_data = np.frombuffer(chunk_data, dtype=np.int16)
                    
                    if needs_resampling and len(int_data) > 0:
                        old_indices = np.arange(len(int_data))
                        new_length = int(len(int_data) * ratio)
                        if new_length > 0:
                            new_indices = np.linspace(0, len(int_data) - 1, new_length)
                            int_data = np.interp(new_indices, old_indices, int_data).astype(np.int16)
                    
                    if tts_volume != 100:
                        float_data = int_data.astype(np.float32) * (tts_volume / 100.0)
                        int_data = np.clip(float_data, -32768, 32767).astype(np.int16)
                    
                    if len(int_data) > 0:
                        while pause_event.is_set():
                            sd.sleep(100)
                            if stop_event.is_set():
                                break
                        
                        if stop_event.is_set():
                            break
                            
                        stream.write(int_data)
            else:
                raise
        
        stream.stop()
        stream.close()
        sd.sleep(600)
        send_message("tts", "stopped")
        
    except Exception as e:
        print(f"TTS playback error: {e}", file=sys.stderr)
        send_message("tts", f"error: {e}")

def set_tts_volume(volume_level):
    """Set TTS volume (0-100)"""
    global tts_volume
    if 0 <= volume_level <= 100:
        tts_volume = volume_level
        print(f"TTS output volume set to {tts_volume}%", file=sys.stderr)
        return tts_volume
    return None

def handle_command(cmd):
    """Handle TTS commands"""
    global pause_event, tts_volume
    
    if isinstance(cmd, str):
        if cmd == "pause":
            pause_event.set()
        elif cmd == "resume":
            pause_event.clear()
            send_message("tts", "resumed")
    elif isinstance(cmd, dict):
        if "volume" in cmd:
            try:
                result = set_tts_volume(int(cmd["volume"]))
                if result is not None:
                    send_message("volume", str(result))
            except ValueError:
                pass
        elif "volume_change" in cmd:
            try:
                change = int(cmd["volume_change"])
                new_volume = max(0, min(100, tts_volume + change))
                result = set_tts_volume(new_volume)
                if result is not None:
                    send_message("volume", str(result))
            except ValueError:
                pass
        elif "volume_get" in cmd:
            send_message("volume", str(tts_volume))

def find_respeaker_device():
    """Find ReSpeaker audio device"""
    try:
        devices = sd.query_devices()
        for i, device in enumerate(devices):
            device_name = str(device['name']).lower()
            if 'respeaker' in device_name and device['max_output_channels'] > 0:
                print(f"Found ReSpeaker output device: {device['name']}", file=sys.stderr)
                return i
        print("No ReSpeaker output device found, using default", file=sys.stderr)
        return None
    except Exception as e:
        print(f"Error finding audio devices: {e}", file=sys.stderr)
        return None

def main():
    """Main TTS loop"""
    global playback_thread, stop_event, pause_event, output_device
    
    output_device = find_respeaker_device()
    print("Ready for text input...", file=sys.stderr)
    
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
            
        try:
            # Parse JSON or use raw text
            try:
                msg = json.loads(line)
            except:
                msg = {}
            
            # Handle commands
            if isinstance(msg, dict):
                if "tts" in msg:
                    handle_command(msg["tts"])
                    continue
                if any(key in msg for key in ["volume", "volume_change", "volume_get"]):
                    handle_command(msg)
                    continue
            
            # Handle TTS request
            text = msg.get("text", "") if isinstance(msg, dict) else line
            model_no = int(msg.get("model", 0)) if isinstance(msg, dict) else 0
            
            if not text or not (0 <= model_no < len(MODEL_NAMES)):
                continue
            
            model_name = MODEL_NAMES[model_no]
            voice = get_voice(model_name)
            print(f"Synthesizing: {text} (model: {model_name})", file=sys.stderr)
            
            # Stop current playback and start new one
            if playback_thread and playback_thread.is_alive():
                stop_event.set()
                playback_thread.join()
            
            stop_event = threading.Event()
            pause_event.clear()
            playback_thread = threading.Thread(
                target=play_stream, 
                args=(voice, text, stop_event, pause_event, output_device)
            )
            playback_thread.start()
            
        except Exception as e:
            print(f"Error: {e}", file=sys.stderr)
            send_message("tts", f"error: {e}")

if __name__ == "__main__":
    main()