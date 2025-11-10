# 🎙️ Audio Broadcaster

A real-time audio broadcasting application with live speech-to-text transcription and translation capabilities. Built with Electron, Node.js, and Python.

[![License](https://img.shields.io/badge/License-Non--Commercial-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-16%2B-green)](https://nodejs.org/)
[![Python](https://img.shields.io/badge/Python-3.8%2B-blue)](https://www.python.org/)
[![Electron](https://img.shields.io/badge/Electron-Desktop%20App-47848F)](https://www.electronjs.org/)

## Features

- **Real-time Audio Broadcasting**: Stream audio to multiple listeners using WebRTC
- **Speech-to-Text Transcription**: Automatic transcription of spoken audio using Google Speech Recognition (free)
- **Live Translation**: Translate transcribed text to multiple languages using MyMemory Translation API (free)
- **Multi-platform Support**: Works on macOS, Windows, and Linux
- **Low Latency**: Optimized for minimal delay in audio transmission
- **Modern UI**: Clean, responsive interface for both broadcasters and listeners
- **100% Free**: No API keys or paid services required

## Architecture

- **Frontend**: HTML5, JavaScript, WebRTC
- **Backend**: Node.js with Express and Socket.IO
- **Desktop App**: Electron framework
- **Transcription Engine**:
  - **Online Mode**: Google's free Web Speech API (requires internet)
  - **Offline Mode**: Vosk (fully open source, no internet required)
- **Translation**: MyMemory Translation API (free, 1000 words/day anonymous)

## Prerequisites

Before running this application, ensure you have:

- **Node.js** (v16 or higher)
- **Python** (v3.8 or higher)
- **npm** or **yarn**
- **Microphone access** on your device
- **Internet connection** (for translation features)

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/yourusername/audio-broadcaster.git
cd audio-broadcaster
```

### 2. Install Node.js dependencies

```bash
npm install
```

### 3. Set up Python environment

```bash
# Create a virtual environment
python3 -m venv venv

# Activate the virtual environment
# On macOS/Linux:
source venv/bin/activate
# On Windows:
venv\Scripts\activate

# Install Python dependencies
pip install -r requirements.txt
```

### 4. Translation Setup (Automatic)

Translation uses MyMemory Translation API by default. No configuration or API key needed!

**Free tier limits**:
- Anonymous usage: 1000 words per day
- With email registration: 10,000 words per day

The free tier is more than sufficient for most church and small organization use cases.

### 5. Offline Mode Setup (Optional - for churches without internet)

By default, the app uses Google's free Web Speech API (requires internet). For offline operation:

**Step 1: Download a Vosk model**
```bash
# Download a small English model (39 MB, good accuracy)
curl -O https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip
unzip vosk-model-small-en-us-0.15.zip
mv vosk-model-small-en-us-0.15 vosk-model

# Or download other models from: https://alphacephei.com/vosk/models
# Larger models offer better accuracy but require more resources
```

**Step 2: Enable offline mode**

Edit `transcribe.py` and change line 15:
```python
TRANSCRIPTION_MODE = 'offline'  # Change from 'online' to 'offline'
```

**Step 3: Restart the app**
```bash
npm start
```

The app will now work completely offline! Perfect for churches in areas with poor/no internet connectivity.

## Usage

### Start the Application

```bash
npm start
```

This will:
1. Launch the Electron app
2. Start the Express server
3. Initialize the Python transcription service

### Broadcaster Interface

The broadcaster window will open automatically. You can:
- Start/stop broadcasting audio
- Enable/disable transcription
- Toggle translation
- Select target language for translation
- View connection information to share with listeners

### Listener Interface

Listeners can connect by opening their browser to:
```
http://[BROADCASTER_IP]:[PORT]/listen_v2.html
```

The broadcaster will display the connection URL in their interface.

## Configuration

### Audio Device Selection

The application will attempt to use your default microphone. You can modify the device selection in `transcribe.py` if needed.

### Supported Languages

The translation feature supports all languages available in Google Cloud Translation API. Common language codes:
- `es` - Spanish
- `fr` - French
- `de` - German
- `ja` - Japanese
- `zh` - Chinese
- And many more...

## Building for Production

To create distributable packages:

```bash
npm run build
```

This will create platform-specific packages in the `dist/` directory.

## Project Structure

```
audio-broadcaster/
├── main.js              # Electron main process
├── preload.js           # Electron preload script
├── transcribe.py        # Python transcription service
├── package.json         # Node.js dependencies
├── requirements.txt     # Python dependencies
└── public/
    ├── broadcaster.html # Broadcaster interface
    ├── listen_v2.html   # Listener interface
    └── test.mp3         # Test audio file
```

## Troubleshooting

### Microphone Not Working

- **macOS**: Grant microphone permissions in System Preferences > Security & Privacy > Microphone
- **Windows**: Check microphone settings in Windows Settings > Privacy > Microphone
- **Linux**: Ensure your user has access to audio devices

### Python Process Fails

- Verify Python virtual environment is activated
- Check that all dependencies are installed: `pip install -r requirements.txt`
- Ensure PyAudio is properly installed (may require system audio libraries)

### Translation Not Working

- Ensure you have an active internet connection
- Check the console logs for any MyMemory API errors
- Verify the target language code is correct (e.g., 'es' for Spanish, 'fr' for French)
- If you exceed the daily limit (1000 words), translation will stop working until the next day

### Port Already in Use

The application will automatically select an available port. If you need a specific port, set the `PORT` environment variable:

```bash
PORT=3000 npm start
```

## Known Limitations

- **Online mode** requires an active internet connection for transcription and translation
- **Offline mode** (Vosk) works without internet but:
  - Only transcription works offline (translation still requires internet)
  - Requires downloading a language model (39+ MB)
  - Small models (vosk-model-small-en-us-0.15) are very sensitive to background noise and may transcribe words when no one is speaking
  - For production use, consider larger models (vosk-model-en-us-0.22, 1.8 GB) which have better silence detection
  - Offline mode is experimental and best tested in quiet, controlled environments
  - Slightly less accurate than Google's online API overall
- Transcription default language is English (can be changed by using different Vosk models)
- Translation requires internet (MyMemory API has daily limit of 1000 words for anonymous usage)
- WebRTC connections may require network configuration for remote access

## 📄 License

This project is licensed under a **Non-Commercial License with Donation Button Requirement**.

**Key Points:**
- ✅ Free to use for churches and non-profit organizations
- ✅ Can modify and adapt for your needs
- ✅ Must keep ChurchApps.org donation button visible
- ❌ Cannot sell or use commercially
- ❌ Cannot remove donation button

See [LICENSE](LICENSE) file for full details.

For commercial licensing inquiries, contact: micheal@livechurchsolutions.org

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

### Development Guidelines
1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Test your changes thoroughly
4. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
5. Push to the branch (`git push origin feature/AmazingFeature`)
6. Open a Pull Request

## 💡 Support & Questions

- **Issues**: GitHub Issues
- **Email**: micheal@livechurchsolutions.org
- **ChurchApps**: [churchapps.org](https://churchapps.org)

## 🙏 Acknowledgments

- Built with ❤️ for churches and non-profit organizations
- MyMemory Translation API for free translation services
- Google Speech Recognition (free tier)
- The Electron, Node.js, and Python communities
- WebRTC for real-time communication
- Thanks to all contributors and organizations using this system

## 📈 Roadmap

- [ ] Multi-language UI support
- [ ] Recording and playback features
- [ ] Advanced audio mixing controls
- [ ] Mobile app for iOS/Android
- [ ] Cloud-based audio relay for larger audiences
- [ ] Integration with streaming platforms

---

**Made with ❤️ for churches and ministry**
