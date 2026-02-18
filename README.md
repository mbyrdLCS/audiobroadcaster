# Audio Broadcaster

A real-time audio broadcasting application with live speech-to-text transcription and per-listener translation. Built for churches — one broadcaster streams audio while listeners on their phones each choose their own language.

[![License](https://img.shields.io/badge/License-Non--Commercial-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-16%2B-green)](https://nodejs.org/)
[![Python](https://img.shields.io/badge/Python-3.8%2B-blue)](https://www.python.org/)
[![Electron](https://img.shields.io/badge/Electron-Desktop%20App-47848F)](https://www.electronjs.org/)

---

## Installing from DMG (for churches)

> **This is the recommended way to install for most users.**

### Step 1 — Download the right DMG

| Your Mac | File to download |
|----------|-----------------|
| Apple Silicon (M1, M2, M3) | `Audio Broadcaster-x.x.x-arm64.dmg` |
| Intel Mac | `Audio Broadcaster-x.x.x.dmg` |

Not sure which you have? Click the Apple menu → About This Mac. If it says "Apple M1" (or M2/M3), download the arm64 version. Otherwise download the regular one.

---

### Step 2 — Install Python 3 (one-time setup)

The app requires Python 3 and two audio packages. Open **Terminal** (search for it in Spotlight) and run:

```bash
pip3 install SpeechRecognition sounddevice
```

If `pip3` is not found, install Python 3 first from [python.org/downloads](https://www.python.org/downloads/) then run the command above again.

---

### Step 3 — Open the DMG

Double-click the downloaded DMG file and drag **Audio Broadcaster** to your Applications folder.

---

### Step 4 — Bypass the macOS security warning

> **Important:** Because this app is not sold through the Mac App Store, macOS will block it the first time you open it. This is normal. Follow these steps:

1. **Do NOT double-click the app** — it will be blocked
2. Right-click (or Control-click) the **Audio Broadcaster** app in your Applications folder
3. Choose **Open** from the menu
4. A dialog appears saying "macOS cannot verify the developer" — click **Open** anyway

You only need to do this **once**. After that, the app opens normally.

![Right-click Open](https://support.apple.com/library/content/dam/edam/applecare/images/en_US/macos/Big-Sur/macos-big-sur-right-click-open-app.jpg)

---

### Step 5 — Grant microphone access

The first time the app runs, macOS will ask for microphone permission. Click **Allow**.

If you accidentally clicked Deny, go to System Preferences → Security & Privacy → Privacy → Microphone and enable Audio Broadcaster.

---

## How to Use

### Broadcaster (the Mac running the app)

1. Open Audio Broadcaster — a window appears showing the connection URL
2. Share the **listener URL** (shown on screen) with your congregation via text or display it on a screen
3. Click **Start Broadcasting** to begin streaming audio
4. Toggle **Translation** on/off — when ON, listeners can receive translated speech in their chosen language

### Listeners (phones and tablets)

1. Open the listener URL in any browser (Safari on iPhone, Chrome on Android)
2. Tap **Play** to start receiving audio
3. Select your language from the dropdown (Spanish, French, Korean, etc.)
4. On **iPhone/iPad**: tap the **"Tap to Enable Voice"** button that appears — this activates translated speech in your language
5. On **Android**: selecting a language automatically enables translated speech

**Two modes for listeners:**
- **Audio only** (Auto-Speak OFF): hear the live audio stream, see translated text on screen
- **Translated voice** (Auto-Speak ON): hear a voice reading the translation in your language (audio stream is silenced)

---

## Supported Languages

| Language | Code |
|----------|------|
| Spanish | es |
| French | fr |
| German | de |
| Chinese | zh |
| Portuguese | pt |
| Russian | ru |
| Arabic | ar |
| Korean | ko |
| Japanese | ja |
| Hindi | hi |
| Italian | it |

---

## Features

- **Real-time audio streaming** via WebRTC — low latency, no delay
- **Automatic transcription** using Google Speech Recognition (free, requires internet)
- **Per-listener language selection** — each person picks their own language independently
- **Text-to-speech translation** — hear the sermon in your language
- **Works on any device** — listeners use any phone browser, no app install required
- **100% free** — no API keys or paid services required

---

## Translation Limits

Translation uses the [MyMemory API](https://mymemory.translated.net/) (free):
- **Anonymous**: 1,000 words/day
- **With email**: 10,000 words/day

For higher limits, open `public/listen_v2.html` and set your email at the top of the script:
```js
const MYMEMORY_EMAIL = 'you@example.com';
```

---

## Building from Source (developers)

### Prerequisites

- Node.js v16+
- Python 3.8+
- npm

### Setup

```bash
git clone https://github.com/yourusername/audio-broadcaster.git
cd audio-broadcaster

# Install Node dependencies
npm install

# Set up Python environment
python3 -m venv venv
source venv/bin/activate        # macOS/Linux
# venv\Scripts\activate         # Windows
pip install -r requirements.txt
```

### Run in development

```bash
npm start
```

### Build DMGs

```bash
npm run build
```

Outputs to `dist/`:
- `Audio Broadcaster-x.x.x.dmg` — Intel Mac
- `Audio Broadcaster-x.x.x-arm64.dmg` — Apple Silicon

---

## Offline Transcription (no internet)

By default the app uses Google's Speech API (requires internet). For churches without internet:

**Option 1 — Vosk (basic offline)**

```bash
# Download English model (39 MB)
curl -O https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip
unzip vosk-model-small-en-us-0.15.zip
mv vosk-model-small-en-us-0.15 vosk-model
pip3 install vosk
```

Edit `transcribe.py` and set `TRANSCRIPTION_MODE = 'offline'`

**Option 2 — Whisper (more accurate offline)**

```bash
pip3 install faster-whisper
```

Edit `transcribe.py` and set `TRANSCRIPTION_MODE = 'whisper'`

> Note: Translation always requires internet (MyMemory API). Offline mode affects transcription only.

---

## Troubleshooting

### "Python not found" or app won't start transcription

Make sure Python 3 is installed and packages are set up:
```bash
python3 --version
pip3 install SpeechRecognition sounddevice
```

### Microphone not working

- Go to System Preferences → Security & Privacy → Privacy → Microphone
- Make sure Audio Broadcaster is checked

### "Cannot be opened because the developer cannot be verified"

Follow Step 4 above — right-click the app and choose Open.

### Translation not working

- Check your internet connection
- You may have hit the 1,000 word/day limit — it resets at midnight UTC
- Set `MYMEMORY_EMAIL` in `listen_v2.html` for 10,000 words/day

### Listeners can't connect

- Make sure your Mac and the listeners' phones are on the same Wi-Fi network
- Check that your firewall allows connections on the port shown in the app

---

## Project Structure

```
audio-broadcaster/
├── main.js              # Electron main process & server
├── preload.js           # Electron preload script
├── transcribe.py        # Python transcription service
├── package.json         # Node.js config & build settings
├── requirements.txt     # Python dependencies
└── public/
    ├── broadcaster.html # Broadcaster interface
    └── listen_v2.html   # Listener interface
```

---

## License

This project is licensed under a **Non-Commercial License with Donation Button Requirement**.

- Free to use for churches and non-profit organizations
- Can modify and adapt for your needs
- Must keep ChurchApps.org donation button visible
- Cannot sell or use commercially
- Cannot remove donation button

See [LICENSE](LICENSE) for full details.

For commercial licensing: micheal@livechurchsolutions.org

---

## Support

- **Issues**: [GitHub Issues](../../issues)
- **Email**: micheal@livechurchsolutions.org
- **ChurchApps**: [churchapps.org](https://churchapps.org)

---

*Made with love for churches and ministry*
