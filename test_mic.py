#!/usr/bin/env python3
import sounddevice as sd
import time

print("Testing microphone access...")
print("This should trigger macOS permission request if needed.")
print("\nSpeak into your microphone for 5 seconds...")

try:
    duration = 5
    recording = sd.rec(int(duration * 16000), samplerate=16000, channels=1, dtype='float32')
    sd.wait()
    print(f"\n✓ Recording successful!")
    print(f"Max volume: {abs(recording).max():.4f}")
    if abs(recording).max() < 0.001:
        print("⚠ WARNING: Volume is very low. Microphone may not be working or permission denied.")
    else:
        print("✓ Microphone is working!")
except Exception as e:
    print(f"❌ Error: {e}")
    print("\nIf you see a permission error, grant microphone access to Terminal in System Preferences.")
