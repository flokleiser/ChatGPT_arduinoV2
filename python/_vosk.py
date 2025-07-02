import os
import sys
import json
import numpy as np
import time
from vosk import Model, KaldiRecognizer

# Constants
DEVICE_INDEX = 0  # Update this to match your headset's device index
RATE = 16000  # Sample rate
CHUNK = 1024  # Frame size
THRESHOLD = 1000  # Adjust this to match your environment's noise level
MODEL_PATH_EN = "STTmodels/vosk-model-en-us-0.22"  # Path to your Vosk model
MODEL_PATH_EN_SMALL = "STTmodels/vosk-model-small-en-us-0.15"  # Path to your Vosk model
MODEL_PATH_GERMAN = "STTmodels/vosk-model-small-de-0.15"  # Path to your Vosk model



class SpeechRecognizer:
    def __init__(self, audio_source, size="medium", callback=None, rate=RATE, chunk=CHUNK):
        self.PAUSE = False
        self.callback = callback or self.default_callback
        self.model_path = MODEL_PATH_EN_SMALL
        self.model = None
        self.recognizer = None
        self.running = False
        self.RATE = rate
        self.CHUNK = chunk
        self.audio_source = audio_source

        if not os.path.exists(self.model_path):
            print(f"Model '{self.model_path}' was not found. Please check the path.", file=sys.stderr)
            exit(1)

        self.model = Model(self.model_path)
        self.recognizer = KaldiRecognizer(self.model, self.RATE)
        self.pre_buffer = []  # Buffer for pre-voice audio
        self.pre_buffer_maxlen = int(1.0 * rate / chunk)  # e.g., 0.4 seconds of audio


    def default_callback(self, text, partial):
        if text:
            print(f"Final Text: {text}", file=sys.stderr)
        if partial:
            print(f"Partial Text: {partial}", file=sys.stderr)

    def run(self):
        self.running = True
        print("\nSpeak now...", file=sys.stderr)

        # Check if voice gating is available
        has_voice_gate = hasattr(self.audio_source, "is_voice_active_enabled") and self.audio_source.is_voice_active_enabled()
        print(f"voiceGate {has_voice_gate}", file=sys.stderr)
        # Choose the appropriate processing method
        if has_voice_gate:
            self._run_with_voice_gate()
        else:
            self._run_without_voice_gate()

    def _run_with_voice_gate(self):
        """Process audio with voice activity detection gating."""
        voice_status_threshold = False
        prev_voice_status_threshold = False
        voice_on_since = None
        voice_off_since = None

        while self.running:
            # --- Voice timing threshold logic ---
            voice_now = self.audio_source.is_voice_active()
            current_time = time.time()

            if voice_now:
                if voice_on_since is None:
                    voice_on_since = current_time
                voice_off_since = None
                if not voice_status_threshold and (current_time - voice_on_since > 0.1):
                    voice_status_threshold = True
            else:
                if voice_off_since is None:
                    voice_off_since = current_time
                voice_on_since = None
                if voice_status_threshold and (current_time - voice_off_since > 0.9):
                    voice_status_threshold = False

            if not self.running:
                break

            # --- Handle transition from speaking to silence (finalize utterance) ---
            if prev_voice_status_threshold and not voice_status_threshold:
                # Feed a few chunks of silence to flush the recognizer
                for _ in range(3):
                    self.recognizer.AcceptWaveform(b'\x00' * self.CHUNK)
                # Get the final result
                result_json = json.loads(self.recognizer.Result())
                text = result_json.get('text', '')
                if text:
                    self.callback(text, None)
                self.recognizer.Reset()
            
            # --- Always read audio, but only process if voice is active ---
            try:
                data = self.audio_source.read(self.CHUNK)
            except OSError as e:
                print(f"Audio input overflow: {e}", file=sys.stderr)
                data = b'\x00' * self.CHUNK 

            if voice_status_threshold:
                # If we just transitioned to True, feed the pre-buffer
                if not prev_voice_status_threshold and self.pre_buffer:
                    for chunk in self.pre_buffer:
                        self.recognizer.AcceptWaveform(chunk)
                    self.pre_buffer.clear()

                if not self.PAUSE:
                    if self.recognizer.AcceptWaveform(data):
                        result_json = json.loads(self.recognizer.Result())
                        text = result_json.get('text', '')
                        if text:
                            self.callback(text, None)
                        self.recognizer.Reset()
                    else:
                        partial_json = json.loads(self.recognizer.PartialResult())
                        partial = partial_json.get('partial', '')
                        self.callback(None, partial)
                else:
                    self.recognizer.Reset()
            else:
                # Buffer the last N chunks before voice activation
                if not self.PAUSE:
                    self.pre_buffer.append(data)
                    if len(self.pre_buffer) > self.pre_buffer_maxlen:
                        self.pre_buffer.pop(0)
                        
            prev_voice_status_threshold = voice_status_threshold

    def _run_without_voice_gate(self):
        """Process audio without voice activity detection."""
        while self.running:
            try:
                data = self.audio_source.read(self.CHUNK)
            except OSError as e:
                print(f"Audio input overflow: {e}", file=sys.stderr)
                data = b'\x00' * self.CHUNK 

            if not self.PAUSE:
                if self.recognizer.AcceptWaveform(data):
                    result_json = json.loads(self.recognizer.Result())
                    text = result_json.get('text', '')
                    if text:
                        self.callback(text, None)
                    self.recognizer.Reset()
                else:
                    partial_json = json.loads(self.recognizer.PartialResult())
                    partial = partial_json.get('partial', '')
                    self.callback(None, partial)
            else:
                self.recognizer.Reset()

        
    def pause(self):
        self.PAUSE = True
        # clear all audio buffers
        
        print("Recognizer paused.", file=sys.stderr)

    def resume(self):
        self.PAUSE = False
        print("Recognizer resumed.", file=sys.stderr)

    def stop(self):
        self.running = False
        print("Recognizer stopped.", file=sys.stderr)
 
    def detect_sound(audio_chunk):
         """Return True if audio chunk above volume threshold."""
         # Decode byte data to int16
         try:
             audio_chunk = np.frombuffer(audio_chunk, dtype=np.int16)
         except ValueError as e:
             print(f"Error decoding audio chunk: {e}",file=sys.stderr)
             return False
         # Inspect the range of audio data
         # print(f"Min: {audio_chunk.min()}, Max: {audio_chunk.max()}"
         # Compute the volume
         volume = np.abs(audio_chunk).max()  # Use absolute to handle both +ve and -ve peaks
          #print(f"Volume: {volume}"
         return volume > THRESHOLD

    