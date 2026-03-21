---
sidebar_position: 3
title: Network & Audio Setup
---

# Network & Audio Setup

## Audio Input — Using Your Live Stream Feed

Most churches will route audio from their existing live stream setup into Audio Broadcaster rather than using the Mac's built-in microphone.

**Common setups:**

| Your setup | How to connect |
|------------|---------------|
| Mixer with USB output | Plug the USB cable from your mixer into the Mac |
| Audio interface (Focusrite, Scarlett, etc.) | Connect via USB — it appears as an audio input automatically |
| Camera with audio output | Use an HDMI capture card, or a 3.5mm cable to the Mac's audio-in jack |
| No live stream / small room | The Mac's built-in mic works fine |

Once connected, select your audio source in the app:

1. Open **Audio Broadcaster**
2. In the broadcaster window, find the **audio input selector**
3. Choose your mixer or audio interface from the dropdown

:::tip
Test the audio level meter in the app before the service starts to confirm it's picking up sound.
:::

## Network Setup

The Mac and all listener phones must be on the **same Wi-Fi network**.

- Use your main church Wi-Fi — not a guest network, which often blocks device-to-device traffic
- The Mac can be on ethernet as long as it's on the same network as the phones
- The app picks a port automatically (usually 3000)

## Finding the Listener URL

When the app starts it shows the listener URL in the broadcaster window — something like:

```
http://192.168.1.5:3000/listen_v2.html
```

Copy this URL — you'll need it to set up the B1 tab below.

:::caution
This URL is tied to your Mac's local IP address. If the IP changes (after a router restart, for example), you'll need to update the URL in B1.
:::

## Adding the Listener URL to B1

1. Log into **B1 Admin** at [app.b1.church](https://app.b1.church)
2. In the left sidebar, click **Settings**
3. In the Settings header, click **Mobile Apps**
4. Click **Add Tab**
5. Fill in the details:
   - **Name:** Listen Live (or whatever label fits your church)
   - **Icon:** Choose something appropriate (headphones, speaker, etc.)
   - **Tab Type:** Website
   - **URL:** Paste your listener URL from the app
   - **Visibility:** Set to everyone, or members only if preferred
6. Click **Save Tab**

Members will see the new tab the next time they open B1. Tapping it opens the audio listener directly in the app.

Continue to [First Run Checklist →](./first-run)
