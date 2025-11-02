# Watch Together - WebRTC YouTube Sync

A real-time synchronized YouTube video watching experience with WebRTC-based chat.

## Features

- **Synchronized YouTube Playback**: Play, pause, and seek videos in perfect sync between two users
- **Real-time Chat**: WebRTC data channel for instant messaging
- **Room-based Connections**: Join specific rooms or create random ones
- **Low Latency Sync**: Uses YouTube IFrame API with WebRTC for minimal delay
- **Network Resilience**: Handles disconnections gracefully

## Quick Start

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Start Server**:
   ```bash
   npm start
   ```

3. **Open Browser**:
   - Navigate to `http://localhost:3000`
   - Enter a room ID (or leave empty for random)
   - Share the room ID with another user
   - Paste a YouTube URL and click "Connect to Peer"

## How It Works

1. **Signaling**: Socket.io handles WebRTC signaling (SDP offers/answers, ICE candidates)
2. **Room Management**: Maximum 2 users per room
3. **Video Sync**: YouTube player state changes are broadcast via WebRTC data channels
4. **Chat**: Messages sent through WebRTC data channels for peer-to-peer communication

## Usage

1. Both users join the same room
2. One user pastes a YouTube URL
3. Click "Connect to Peer" to establish WebRTC connection
4. Video controls (play/pause/seek) sync automatically
5. Use chat for real-time communication

## Tech Stack

- **Frontend**: HTML, CSS, JavaScript, YouTube IFrame API, WebRTC
- **Backend**: Node.js, Express, Socket.io
- **Real-time**: WebRTC for P2P data channels and video sync