# Audio Broadcaster

A real-time audio broadcasting application with live speech-to-text transcription and translation capabilities. Built with Electron, Node.js, and Python.

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
- **Transcription Engine**: Python with SpeechRecognition library (uses free Google Speech API)
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

- Transcription currently only supports English speech input (can be changed in transcribe.py)
- Translation requires an active internet connection
- WebRTC connections may require network configuration for remote access
- MyMemory API has a daily limit of 1000 words for anonymous usage

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- MyMemory Translation API for free translation services
- Google Speech Recognition (free tier)
- The Electron, Node.js, and Python communities
- WebRTC for real-time communication
- Built for churches and non-profit organizations

## Support

For issues, questions, or contributions, please open an issue on the GitHub repository.
