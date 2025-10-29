#!/usr/bin/env python3
import sounddevice as sd

print("Available audio devices:\n")
devices = sd.query_devices()
for i, device in enumerate(devices):
    if device['max_input_channels'] > 0:
        print(f"[{i}] {device['name']}")
        print(f"    Input channels: {device['max_input_channels']}")
        print(f"    Sample rate: {device['default_samplerate']}")
        print()

print("\nDefault input device:")
default_input = sd.default.device[0]
print(f"  Index: {default_input}")
print(f"  Device: {devices[default_input]['name']}")
