---
sidebar_position: 2
title: Installation
---

# Installation

## Step 1 — Download the App

Go to the [latest release on GitHub](https://github.com/mbyrdLCS/audiobroadcaster/releases/latest) and download the right file for your Mac:

| Your Mac | File to download |
|----------|-----------------|
| Apple Silicon (M1, M2, M3, M4) | `Audio Broadcaster-x.x.x-arm64.dmg` |
| Intel Mac | `Audio Broadcaster-x.x.x.dmg` |

Not sure which you have? Click the Apple menu → **About This Mac**. If it says "Apple M1" (or M2/M3/M4), download the arm64 version.

## Step 2 — Install the App

1. Open the downloaded `.dmg` file
2. Drag **Audio Broadcaster** into your Applications folder
3. Eject the DMG

## Step 3 — Install Python 3 (one-time)

The transcription and translation features require Python 3. Open **Terminal** (search for it in Spotlight) and run:

```bash
pip3 install --user SpeechRecognition sounddevice
```

If you see a **"Python not found"** error, install Python 3 first from [python.org/downloads](https://www.python.org/downloads/), then run the command above again.

If you see an **"externally managed environment"** error, run this instead:
```bash
pip3 install --break-system-packages SpeechRecognition sounddevice
```

:::note
If you only need audio streaming (no transcription or translation), you can skip this step.
:::

## Step 4 — Open the App

Open **Audio Broadcaster** from your Applications folder. The first time you open it, macOS will ask for **microphone permission** — click **Allow**.

The app window will appear showing the listener URL your congregation will use.

Continue to [Network & Audio Setup →](./network)
