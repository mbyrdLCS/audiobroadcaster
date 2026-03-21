---
sidebar_position: 5
title: Troubleshooting
---

# Troubleshooting (Setup)

## Listeners can't connect / page won't load

- Confirm the Mac and the phones are on the **same Wi-Fi network** — not a guest network
- Check the listener URL in B1 matches what the app currently shows
- Try opening the listener URL directly in a phone browser to rule out a B1 issue
- Restart Audio Broadcaster and check if the IP address changed

## No audio on listener phones

- Check the audio level meter in the broadcaster window — is it moving?
- Make sure the correct audio input is selected in the app
- On iPhone, make sure the phone is **not on silent** (the hardware mute switch on the side)
- Try tapping **Play** again on the listener page

## App won't open / macOS blocks it

Make sure you downloaded version 1.2.0 or later — older versions required a Terminal workaround. Download the latest from the [GitHub releases page](https://github.com/mbyrdLCS/audiobroadcaster/releases/latest).

## Microphone permission denied

1. Open **System Settings** (or System Preferences on older Macs)
2. Go to **Privacy & Security → Microphone**
3. Make sure **Audio Broadcaster** is toggled on

## Translation not working

- Check the Mac's internet connection — translation requires internet
- You may have hit the free daily translation limit (1,000 words/day) — it resets at midnight UTC
- Audio streaming still works even when translation is unavailable

## The listener URL changed after a restart

Your Mac's IP address can change when it reconnects to Wi-Fi. To prevent this:
- Ask your IT person or internet provider to assign the Mac a **static/reserved IP address** on your router
- Or plug the Mac into ethernet — wired connections tend to hold the same IP longer

Once you have a stable IP, update the URL in B1 and it won't change again.

## Still need help?

Contact support at [micheal@livechurchsolutions.org](mailto:micheal@livechurchsolutions.org) or open an issue on [GitHub](https://github.com/mbyrdLCS/audiobroadcaster/issues).
