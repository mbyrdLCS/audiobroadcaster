# Audio Broadcaster

A real-time audio broadcasting application with live speech-to-text transcription and per-listener translation. Built for churches — one broadcaster streams audio while listeners on their phones each choose their own language.

[![License](https://img.shields.io/badge/License-Non--Commercial-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-16%2B-green)](https://nodejs.org/)
[![Electron](https://img.shields.io/badge/Electron-Desktop%20App-47848F)](https://www.electronjs.org/)

---

## Installing from DMG (for churches)

> **This is the recommended way to install for most users.**

### Step 1 — Download the right DMG

| Your Mac | File to download |
|----------|-----------------|
| Apple Silicon (M1, M2, M3, M4) | `Audio Broadcaster-x.x.x-arm64.dmg` |
| Intel Mac | `Audio Broadcaster-x.x.x.dmg` |

Not sure which you have? Click the Apple menu → About This Mac. If it says "Apple M1" (or M2/M3/M4), download the arm64 version. Otherwise download the regular one.

---

> **Transcription is built in** — no Python or additional software required.

---

### Step 2 — Open the DMG

Double-click the downloaded DMG file and drag **Audio Broadcaster** to your Applications folder.

---

### Step 3 — Grant microphone access

The first time the app runs, macOS will ask for microphone permission. Click **Allow**.

If you accidentally clicked Deny, go to **System Settings → Privacy & Security → Microphone** (macOS Ventura and later) or **System Preferences → Security & Privacy → Privacy → Microphone** (older macOS) and enable Audio Broadcaster.

---

## How to Use

### Broadcaster (the Mac running the app)

1. Open Audio Broadcaster — a window appears showing the connection URL
2. Share the **listener URL** (shown on screen) with your congregation via text or display it on a screen
3. Click **Start Broadcasting** to begin streaming audio
4. Toggle **Translation** on/off — when ON, listeners can receive translated speech in their chosen language

### Listeners (phones and tablets)

1. Open the **B1 app** and tap the **Listen Live** tab — or open the listener URL directly in Safari (iPhone) or Chrome (Android)
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
- **Automatic transcription** using bundled whisper.cpp (offline, no API keys required)
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

- macOS 10.15 (Catalina) or later
- Node.js v16+
- npm

### Setup

```bash
git clone https://github.com/mbyrdLCS/audiobroadcaster.git
cd audiobroadcaster

# Build the bundled whisper.cpp binary and download models (one-time)
# This populates resources/whisper/ which is bundled into the DMG
./scripts/build-whisper.sh

# Install Node dependencies
npm install
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

## Troubleshooting

### Microphone not working

- Go to **System Settings → Privacy & Security → Microphone** (macOS Ventura and later) or **System Preferences → Security & Privacy → Privacy → Microphone** (older macOS)
- Make sure Audio Broadcaster is checked

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
├── package.json         # Node.js config & build settings
├── scripts/
│   └── build-whisper.sh # Builds whisper.cpp binary + downloads models (run once)
├── resources/
│   └── whisper/         # Built binary & model (git-ignored; populated by build-whisper.sh)
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

- **Issues**: [GitHub Issues](https://github.com/mbyrdLCS/audiobroadcaster/issues)
- **Email**: micheal@livechurchsolutions.org
- **ChurchApps**: [churchapps.org](https://churchapps.org)

---

*Made with love for churches and ministry*
