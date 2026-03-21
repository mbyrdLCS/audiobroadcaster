import sys
import time
import threading
import queue
import base64
import sounddevice as sd
import speech_recognition as sr
import numpy as np
import os
import json

# ============================================================================
# CONFIGURATION: Choose your transcription mode
# ============================================================================
# Set to 'online'  for Google's free Web Speech API (requires internet)
# Set to 'offline' for Vosk (no internet required, fully open source)
# Set to 'whisper' for faster-whisper (offline, much more accurate, recommended)
TRANSCRIPTION_MODE = 'whisper'  # Change to 'online', 'offline', or 'whisper'

# For offline mode: Path to Vosk model directory
# Download models from: https://alphacephei.com/vosk/models
# Recommended: vosk-model-small-en-us-0.15 (39 MB) for English
VOSK_MODEL_PATH = os.path.join(os.path.dirname(__file__), 'vosk-model')

# For whisper mode: model size (tiny.en, base.en, small.en)
# base.en is the recommended sweet spot for accuracy vs. speed
WHISPER_MODEL_SIZE = 'base.en'

# ============================================================================

# Configure audio input dynamically
def get_device_info(device_index):
    try:
        devices = sd.query_devices()
        if 0 <= device_index < len(devices):
            device_info = devices[device_index]
            print(f"Device {device_index} ({device_info['name']}): Max input channels = {device_info['max_input_channels']}", file=sys.stderr)
            return device_info
        else:
            raise ValueError(f"Invalid device index: {device_index}")
    except Exception as e:
        print(f"Error querying device {device_index}: {e}", file=sys.stderr)
        return None

# Dynamically select the "MacBook Pro Microphone" or fallback to default input device
def find_macbook_pro_mic():
    devices = sd.query_devices()
    for i, device in enumerate(devices):
        if device['name'] == 'MacBook Pro Microphone' and device['max_input_channels'] > 0:
            print(f"Found MacBook Pro Microphone at index {i}", file=sys.stderr)
            return i
    print("MacBook Pro Microphone not found, falling back to default input device", file=sys.stderr)
    default_device = sd.default.device
    # sd.default.device can be an int, a tuple (in, out), or a dict depending on version
    if isinstance(default_device, dict):
        return default_device['input']
    elif isinstance(default_device, (list, tuple)):
        return default_device[0]
    else:
        return int(default_device)

# Set device (default to MacBook Pro Microphone or fallback)
device_index = find_macbook_pro_mic()
_fallback_idx = device_index if device_index is not None else 0
device_info = get_device_info(device_index) or sd.query_devices()[_fallback_idx]
channels = device_info['max_input_channels'] if device_info['max_input_channels'] > 0 else 1
samplerate = 16000

sd.default.samplerate = samplerate
sd.default.channels = channels
sd.default.device = device_index

print(f"Using device {device_index} ({device_info['name']}) with {channels} channels, samplerate={samplerate}", file=sys.stderr)
print("Available audio devices:", sd.query_devices(), file=sys.stderr)

# Initialize speech recognizer based on mode
recognizer = sr.Recognizer()
vosk_model = None
vosk_recognizer = None
whisper_model = None

if TRANSCRIPTION_MODE == 'offline':
    try:
        from vosk import Model, KaldiRecognizer
        print(f"Loading Vosk model from: {VOSK_MODEL_PATH}", file=sys.stderr)
        if not os.path.exists(VOSK_MODEL_PATH):
            print(f"ERROR: Vosk model not found at {VOSK_MODEL_PATH}", file=sys.stderr)
            print("Download a model from https://alphacephei.com/vosk/models", file=sys.stderr)
            print("Recommended: vosk-model-small-en-us-0.15 (39 MB)", file=sys.stderr)
            print("Falling back to online mode...", file=sys.stderr)
            TRANSCRIPTION_MODE = 'online'
        else:
            vosk_model = Model(VOSK_MODEL_PATH)
            vosk_recognizer = KaldiRecognizer(vosk_model, samplerate)
            print(f"Vosk model loaded successfully - OFFLINE MODE ACTIVE", file=sys.stderr)
    except ImportError:
        print("ERROR: Vosk not installed. Run: pip install vosk", file=sys.stderr)
        print("Falling back to online mode...", file=sys.stderr)
        TRANSCRIPTION_MODE = 'online'

elif TRANSCRIPTION_MODE == 'whisper':
    try:
        from faster_whisper import WhisperModel
        # Check if model is already cached to show helpful status
        _cache_dir = os.path.join(os.path.expanduser("~"), ".cache", "huggingface", "hub")
        _model_cache = os.path.join(_cache_dir, f"models--Systran--faster-whisper-{WHISPER_MODEL_SIZE}")
        if not os.path.isdir(_model_cache):
            print(f"STATUS:Downloading Whisper model (first run only, ~145MB)...", flush=True)
        else:
            print(f"STATUS:Loading Whisper model...", flush=True)
        whisper_model = WhisperModel(WHISPER_MODEL_SIZE, device="cpu", compute_type="int8")
        print(f"STATUS:Whisper model ready", flush=True)
        print(f"Whisper model loaded successfully - WHISPER MODE ACTIVE", file=sys.stderr)
    except ImportError:
        print("STATUS:⚠️ Translation requires faster-whisper. Open Terminal and run: pip3 install faster-whisper --break-system-packages — then restart the app.", flush=True)
        print("ERROR: faster-whisper not installed.", file=sys.stderr)
        TRANSCRIPTION_MODE = 'none'

print(f"Transcription mode: {TRANSCRIPTION_MODE.upper()}", file=sys.stderr)

# Control flags
listening = False
stop_event = threading.Event()

# Queue used to pass audio chunks from stdin to the whisper transcription loop.
# In whisper mode, Python never opens the microphone directly — the broadcaster
# sends raw PCM via the Node.js server over stdin to avoid a CoreAudio conflict
# that would crash Chromium's renderer when two processes open the same mic.
audio_queue = queue.Queue()

# Sample rate used by the broadcaster's AudioContext (hardcoded to match
# broadcaster.html: new AudioContext({ sampleRate: 44100 }))
BROADCASTER_RATE = 44100

def read_commands():
    """
    Read commands AND audio chunks from stdin.
    Protocol (line-based):
      START       -> begin transcription
      STOP        -> end transcription
      AUDIO:<b64> -> base64-encoded Int16 PCM at BROADCASTER_RATE Hz
    """
    global listening
    print("Waiting for commands... (send 'START' to begin, 'STOP' to end)", file=sys.stderr)
    while not stop_event.is_set():
        try:
            line = sys.stdin.readline()
            if not line:
                break
            line = line.strip()
            if line == "START":
                listening = True
                print("Starting transcription...", file=sys.stderr)
            elif line == "STOP":
                listening = False
                print("Stopping transcription...", file=sys.stderr)
                # Drain the queue so stale audio isn't processed after restart
                while not audio_queue.empty():
                    try:
                        audio_queue.get_nowait()
                    except queue.Empty:
                        break
            elif line.startswith("AUDIO:") and TRANSCRIPTION_MODE == 'whisper' and listening:
                raw = base64.b64decode(line[6:])
                chunk = np.frombuffer(raw, dtype=np.int16).copy()
                audio_queue.put(chunk)
        except Exception as e:
            print(f"Command read error: {e}", file=sys.stderr)

# Start command/audio reader thread
command_thread = threading.Thread(target=read_commands, daemon=True)
command_thread.start()

# Main transcription loop
def remove_repetitive_words(transcript):
    words = transcript.split()
    if len(words) <= 1:
        return transcript
    filtered_words = [words[0]]
    for i in range(1, len(words)):
        if words[i] != words[i-1]:  # Only add the word if it's different from the previous one
            filtered_words.append(words[i])
    return " ".join(filtered_words)

try:
    while not stop_event.is_set():
        if listening:
            print("Listening for speech...", file=sys.stderr)

            if TRANSCRIPTION_MODE == 'online':
                # ONLINE MODE: Using Google's free Web Speech API
                with sr.Microphone(device_index=device_index, sample_rate=samplerate) as source:
                    recognizer.adjust_for_ambient_noise(source, duration=1)
                    print("Adjusted for ambient noise", file=sys.stderr)

                    while listening and not stop_event.is_set():
                        try:
                            audio = recognizer.listen(source, timeout=5, phrase_time_limit=10)
                            transcript = recognizer.recognize_google(audio)
                            if transcript:
                                print(f"DEBUG: Transcript='{transcript}'", file=sys.stderr)
                                filtered_transcript = remove_repetitive_words(transcript)
                                print(filtered_transcript, flush=True)
                        except sr.WaitTimeoutError:
                            print("DEBUG: No speech detected within timeout", file=sys.stderr)
                        except sr.UnknownValueError:
                            print("DEBUG: Could not understand audio", file=sys.stderr)
                        except sr.RequestError as e:
                            print(f"Speech recognition error: {e}", file=sys.stderr)
                        except Exception as e:
                            print(f"Unexpected error: {e}", file=sys.stderr)

            elif TRANSCRIPTION_MODE == 'whisper':
                # WHISPER MODE: Receive audio from the broadcaster via stdin.
                # Python never opens the microphone — this avoids a CoreAudio
                # notification that crashes the Chromium renderer when two processes
                # open the same device simultaneously.
                print("Waiting for audio from broadcaster...", file=sys.stderr)
                audio_buffer = []
                accumulate_target = BROADCASTER_RATE * 5  # 5 seconds of audio

                while listening and not stop_event.is_set():
                    try:
                        chunk = audio_queue.get(timeout=0.5)
                        audio_buffer.append(chunk)
                        if sum(len(c) for c in audio_buffer) >= accumulate_target:
                            audio_np = np.concatenate(audio_buffer).astype(np.float32) / 32768.0
                            audio_buffer = []
                            # Resample from BROADCASTER_RATE (44100Hz) to 16000Hz for Whisper
                            target_len = int(len(audio_np) * 16000 / BROADCASTER_RATE)
                            audio_np = np.interp(
                                np.linspace(0, len(audio_np) - 1, target_len),
                                np.arange(len(audio_np)),
                                audio_np
                            ).astype(np.float32)
                            segments, _ = whisper_model.transcribe(audio_np, beam_size=5, language='en')
                            transcript = ' '.join(s.text.strip() for s in segments).strip()
                            if transcript:
                                print(f"DEBUG: Transcript='{transcript}'", file=sys.stderr)
                                filtered_transcript = remove_repetitive_words(transcript)
                                if filtered_transcript:
                                    print(filtered_transcript, flush=True)
                    except queue.Empty:
                        pass  # No audio yet, keep waiting
                    except Exception as e:
                        print(f"Whisper error: {e}", file=sys.stderr)

            elif TRANSCRIPTION_MODE == 'none':
                # Missing dependency — message already sent to UI, just idle
                time.sleep(1)

            else:
                # OFFLINE MODE: Using Vosk
                print("Starting offline transcription with Vosk...", file=sys.stderr)
                with sd.RawInputStream(samplerate=samplerate, blocksize=8000, device=device_index,
                                      dtype='int16', channels=1) as stream:
                    print("Vosk stream opened, listening...", file=sys.stderr)

                    while listening and not stop_event.is_set():
                        try:
                            data = stream.read(4000)[0]
                            if vosk_recognizer.AcceptWaveform(bytes(data)):
                                result = json.loads(vosk_recognizer.Result())
                                if result.get('text'):
                                    transcript = result['text']
                                    print(f"DEBUG: Transcript='{transcript}'", file=sys.stderr)
                                    filtered_transcript = remove_repetitive_words(transcript)
                                    if filtered_transcript:
                                        print(filtered_transcript, flush=True)
                        except Exception as e:
                            print(f"Vosk error: {e}", file=sys.stderr)
        else:
            time.sleep(0.1)
except Exception as e:
    print(f"Transcription error: {e}", file=sys.stderr)
finally:
    stop_event.set()
    command_thread.join(timeout=2)
    print("Transcription shutdown complete", file=sys.stderr)