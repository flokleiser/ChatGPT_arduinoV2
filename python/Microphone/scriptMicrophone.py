import pyaudio
import sounddevice as sd
import sys
from Microphone.seeedReSpeaker4mic import ReSpeaker4MicArray 
from Microphone.ReSpeakerLite import ReSpeakerLite 
class MicrophoneStream:
    def __init__(self, rate=16000, chunk=1024, format=pyaudio.paInt16):
        # List all available audio devices
        devices = sd.query_devices()
        print("Available audio devices:", file=sys.stderr)
        for i, device in enumerate(devices):
            print(f"{i}: {device['name']} (Input Channels: {device['max_input_channels']})", file=sys.stderr)    

        self.respeak_active = False
        self.respeaker = None
        self.respeakerID = None

        # Try to find ReSpeaker device
        for i, device in enumerate(devices):
            if "ReSpeaker Lite" in device['name']:
                #get product ID
                print(device, file=sys.stderr) 
                print("ReSpeaker Lite device found", file=sys.stderr) 
                self.respeakerID = 0
                self.respeak_active = True
                break
            elif "ReSpeaker" in device['name']:
                #get product ID
                print(device, file=sys.stderr) 
                print("ReSpeaker device found", file=sys.stderr) 
                self.respeakerID = 1
                self.respeak_active = True
                break

        if self.respeak_active:
            # Always use ReSpeakerfor audio if available
            if (self.respeakerID == 0):
                self.respeaker = ReSpeakerLite(rate=rate, chunk=chunk, format=format)
            else:
                self.respeaker = ReSpeaker4MicArray(rate=rate, chunk=chunk, format=format)
            # fist close any existing stream  
            self.stream = self.respeaker.open_stream()
        else:
            # Fallback to default input device using PyAudio
            self.p = pyaudio.PyAudio()
            input_device = self.p.get_default_input_device_info()['index']
            try:
                self.stream = self.p.open(
                    format=format,
                    channels=1,
                    rate=rate,
                    input=True,
                    frames_per_buffer=chunk,
                    input_device_index=input_device
                )
            except Exception as e:
                print(f"Could not open audio stream: {e}", file=sys.stderr) 
                raise
    
    def is_voice_active(self):
        """Check if voice is active using ReSpeaker's tuning module."""
        if self.respeak_active and self.respeaker:
            return self.respeaker.is_voice_active()
        return True 
    
    def is_voice_active_enabled(self):
        """check if voice activity detection is enabled."""
        if self.respeak_active and self.respeaker and self.respeakerID == 1:
            return True
        return False 


    def read(self, chunk=None):  
        if self.respeak_active and self.respeaker:
            #direction = self.respeaker.get_doa()
            #print(f"Current direction: {direction}")
            #print("active:", self.respeaker.is_voice_active()) 
            return self.respeaker.read(chunk)
        return self.stream.read(chunk or 1024, exception_on_overflow=False)

    def close(self):
            #Closes the audio stream and terminates PyAudio cleanly.
            if self.respeak_active and self.respeaker:
                try:
                    self.respeaker.close_stream()
                except Exception as e:
                    print(f"Error closing ReSpeaker stream: {e}", file=sys.stderr) 
                try:
                    self.respeaker.p.terminate()
                except Exception as e:
                    print(f"Error terminating ReSpeaker PyAudio: {e}", file=sys.stderr) 
            else:
                try:
                    if self.stream.is_active():
                        self.stream.stop_stream()
                    self.stream.close()
                except Exception as e:
                    print(f"Error closing default stream: {e}", file=sys.stderr) 
                try:
                    self.p.terminate()
                except Exception as e:
                    print(f"Error terminating default PyAudio: {e}", file=sys.stderr) 