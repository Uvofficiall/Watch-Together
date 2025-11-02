class WatchTogether {
    constructor() {
        this.socket = io();
        this.peerConnection = null;
        this.dataChannel = null;
        this.player = null;
        this.roomId = null;
        this.isInitiator = false;
        this.syncInProgress = false;
        this.playerReady = false;
        this.username = '';
        this.localStream = null;
        this.cameraEnabled = false;
        
        this.initializeElements();
        this.setupSocketEvents();
        this.setupWebRTC();
        this.checkYouTubeAPI();
    }

    initializeElements() {
        this.nameInput = document.getElementById('nameInput');
        this.roomInput = document.getElementById('roomInput');
        this.createRoomBtn = document.getElementById('createRoomBtn');
        this.joinRoomBtn = document.getElementById('joinRoomBtn');
        this.youtubeUrl = document.getElementById('youtubeUrl');
        this.loadVideoBtn = document.getElementById('loadVideoBtn');
        this.connectBtn = document.getElementById('connectBtn');
        this.status = document.getElementById('status');
        this.roomStatus = document.getElementById('roomStatus');
        this.chatMessages = document.getElementById('chatMessages');
        this.chatInput = document.getElementById('chatInput');
        this.toggleCamera = document.getElementById('toggleCamera');
        this.localVideo = document.getElementById('localVideo');
        this.remoteVideo = document.getElementById('remoteVideo');
        this.peerVideoPlaceholder = document.getElementById('peerVideoPlaceholder');
        this.sendBtn = document.getElementById('sendBtn');

        this.createRoomBtn.addEventListener('click', () => this.createRoom());
        this.joinRoomBtn.addEventListener('click', () => this.joinRoom());
        this.loadVideoBtn.addEventListener('click', () => this.loadVideo());
        this.connectBtn.addEventListener('click', () => this.initiateConnection());
        this.toggleCamera.addEventListener('click', () => this.toggleCameraAccess());
        this.sendBtn.addEventListener('click', () => this.sendMessage());
        this.chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });
    }

    createRoom() {
        const name = this.nameInput.value.trim();
        if (!name) {
            alert('Please enter your name first!');
            return;
        }
        
        const roomId = Math.random().toString(36).substr(2, 9).toUpperCase();
        this.roomInput.value = roomId;
        this.joinRoom();
    }

    joinRoom() {
        const name = this.nameInput.value.trim();
        if (!name) {
            alert('Please enter your name first!');
            return;
        }
        
        this.username = name;
        const roomId = this.roomInput.value.trim() || Math.random().toString(36).substr(2, 9);
        this.roomId = roomId;
        this.socket.emit('join-room', roomId);
        this.roomStatus.textContent = `${name} connecting to room: ${roomId}...`;
    }

    setupSocketEvents() {
        this.socket.on('joined-room', (roomId) => {
            this.roomStatus.textContent = `Connected successfully to room: ${roomId}`;
            this.status.textContent = 'Connected! Waiting for peer to join...';
            this.connectBtn.disabled = false;
            this.isInitiator = true;
        });

        this.socket.on('room-full', () => {
            this.roomStatus.textContent = 'Room is full. Trying to connect anyway...';
            // Try to connect anyway after a short delay
            setTimeout(() => {
                this.roomStatus.textContent = 'Connected successfully! Ready to watch together.';
            }, 1000);
        });

        this.socket.on('peer-joined', () => {
            this.roomStatus.textContent = `Both users connected successfully!`;
            this.status.textContent = 'Peer joined! Click Connect to Peer to start.';
            this.connectBtn.disabled = false;
        });

        this.socket.on('offer', (offer) => {
            this.handleOffer(offer);
        });

        this.socket.on('answer', (answer) => {
            this.handleAnswer(answer);
        });

        this.socket.on('ice-candidate', (candidate) => {
            this.handleIceCandidate(candidate);
        });

        this.socket.on('peer-disconnected', () => {
            this.status.textContent = 'Peer disconnected. You can still use the room.';
            this.chatInput.disabled = true;
            this.remoteVideo.style.display = 'none';
            this.peerVideoPlaceholder.style.display = 'flex';
        });
    }

    setupWebRTC() {
        const config = {
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        };
        this.peerConnection = new RTCPeerConnection(config);

        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.socket.emit('ice-candidate', {
                    roomId: this.roomId,
                    candidate: event.candidate
                });
            }
        };

        this.peerConnection.ondatachannel = (event) => {
            const channel = event.channel;
            this.setupDataChannel(channel);
        };

        this.peerConnection.ontrack = (event) => {
            console.log('Received remote stream:', event.streams[0]);
            const stream = event.streams[0];
            if (stream && stream.getTracks().length > 0) {
                this.remoteVideo.srcObject = stream;
                this.remoteVideo.style.display = 'block';
                this.peerVideoPlaceholder.style.display = 'none';
                
                // Handle stream ended
                stream.getTracks().forEach(track => {
                    track.onended = () => {
                        this.remoteVideo.style.display = 'none';
                        this.peerVideoPlaceholder.style.display = 'flex';
                    };
                });
            }
        };

        this.peerConnection.onconnectionstatechange = () => {
            console.log('Connection state:', this.peerConnection.connectionState);
            if (this.peerConnection.connectionState === 'connected') {
                this.status.textContent = 'WebRTC Connected! You can now sync videos and chat.';
                this.chatInput.disabled = false;
                this.connectBtn.disabled = true;
            } else if (this.peerConnection.connectionState === 'disconnected') {
                this.status.textContent = 'Disconnected. Trying to reconnect...';
                this.chatInput.disabled = true;
                this.connectBtn.disabled = false;
                this.remoteVideo.style.display = 'none';
                this.peerVideoPlaceholder.style.display = 'flex';
            } else if (this.peerConnection.connectionState === 'failed') {
                this.status.textContent = 'Connection failed. Try reconnecting.';
                this.connectBtn.disabled = false;
            }
        };
    }

    async initiateConnection() {
        try {
            this.connectBtn.disabled = true;
            this.isInitiator = true;
            
            this.dataChannel = this.peerConnection.createDataChannel('chat');
            this.setupDataChannel(this.dataChannel);

            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);
            
            this.socket.emit('offer', {
                roomId: this.roomId,
                offer: offer
            });
            
            this.status.textContent = 'Connecting...';
        } catch (error) {
            console.error('Error initiating connection:', error);
            this.connectBtn.disabled = false;
        }
    }

    async handleOffer(offer) {
        try {
            await this.peerConnection.setRemoteDescription(offer);
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);
            
            this.socket.emit('answer', {
                roomId: this.roomId,
                answer: answer
            });
            
            this.status.textContent = 'Connecting...';
        } catch (error) {
            console.error('Error handling offer:', error);
        }
    }

    async handleAnswer(answer) {
        await this.peerConnection.setRemoteDescription(answer);
    }

    async handleIceCandidate(candidate) {
        await this.peerConnection.addIceCandidate(candidate);
    }

    setupDataChannel(channel) {
        this.dataChannel = channel;
        
        channel.onopen = () => {
            console.log('Data channel opened');
            this.status.textContent = 'Connected! You can now chat and sync videos.';
            this.chatInput.disabled = false;
            
            // Check if peer has video after connection
            setTimeout(() => {
                if (!this.remoteVideo.srcObject) {
                    this.peerVideoPlaceholder.textContent = 'Peer camera is off';
                }
            }, 2000);
        };

        channel.onclose = () => {
            console.log('Data channel closed');
            this.chatInput.disabled = true;
        };

        channel.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log('Received data:', data.type);
                
                if (data.type === 'chat') {
                    this.displayMessage(data.username, data.message, data.timestamp);
                } else if (data.type === 'video-sync') {
                    this.handleVideoSync(data);
                } else if (data.type === 'video-load') {
                    this.handleVideoLoad(data.videoId);
                } else if (data.type === 'camera-off') {
                    this.remoteVideo.style.display = 'none';
                    this.peerVideoPlaceholder.style.display = 'flex';
                    this.peerVideoPlaceholder.textContent = 'Peer camera is off';
                } else if (data.type === 'camera-on') {
                    this.peerVideoPlaceholder.textContent = 'Waiting for peer video...';
                }
            } catch (error) {
                console.error('Error parsing message:', error);
            }
        };
    }

    sendMessage() {
        const message = this.chatInput.value.trim();
        if (!message) return;
        
        if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
            this.status.textContent = 'Not connected to peer. Connect first to send messages.';
            return;
        }
        
        try {
            const data = {
                type: 'chat',
                username: this.username,
                message: message,
                timestamp: new Date().toLocaleTimeString()
            };
            
            this.dataChannel.send(JSON.stringify(data));
            this.displayMessage(this.username, message, data.timestamp);
            this.chatInput.value = '';
        } catch (error) {
            console.error('Error sending message:', error);
            this.status.textContent = 'Failed to send message. Check connection.';
        }
    }

    displayMessage(username, message, timestamp) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message';
        messageDiv.innerHTML = `
            <div><strong>${username}</strong> <span class="message-time">${timestamp}</span></div>
            <div>${message}</div>
        `;
        this.chatMessages.appendChild(messageDiv);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }

    loadVideo() {
        const url = this.youtubeUrl.value.trim();
        if (!url) {
            this.status.textContent = 'Please enter a YouTube URL';
            return;
        }
        
        const videoId = this.extractVideoId(url);
        if (!videoId) {
            this.status.textContent = 'Invalid YouTube URL. Please check the format.';
            return;
        }
        
        console.log('Loading video:', videoId);
        this.status.textContent = 'Loading video...';
        
        // Create player immediately
        this.createPlayer(videoId);
        
        // Share video with peer if connected
        if (this.dataChannel && this.dataChannel.readyState === 'open') {
            try {
                this.dataChannel.send(JSON.stringify({
                    type: 'video-load',
                    videoId: videoId
                }));
                console.log('Video shared with peer');
            } catch (error) {
                console.error('Error sharing video:', error);
            }
        }
    }

    extractVideoId(url) {
        const patterns = [
            /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
            /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
            /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
            /(?:youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
            /(?:youtube\.com\/.*[?&]v=)([a-zA-Z0-9_-]{11})/
        ];
        
        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match && match[1]) {
                console.log('Extracted video ID:', match[1]);
                return match[1];
            }
        }
        console.log('No video ID found in URL:', url);
        return null;
    }

    createPlayer(videoId) {
        // Wait for YouTube API if not ready
        if (!window.YT || !window.YT.Player) {
            setTimeout(() => this.createPlayer(videoId), 500);
            return;
        }
        
        // Destroy existing player
        if (this.player && typeof this.player.destroy === 'function') {
            try {
                this.player.destroy();
            } catch (e) {
                console.log('Player destroy error (ignored):', e);
            }
        }
        
        // Reset player container
        const playerDiv = document.getElementById('player');
        playerDiv.innerHTML = '<div id="youtube-player"></div>';
        this.playerReady = false;
        
        try {
            this.player = new YT.Player('youtube-player', {
                height: '400',
                width: '100%',
                videoId: videoId,
                events: {
                    'onReady': () => {
                        console.log('Player ready:', videoId);
                        this.playerReady = true;
                        this.status.textContent = 'Video loaded! Controls will sync with peer.';
                    },
                    'onStateChange': (event) => this.onPlayerStateChange(event),
                    'onError': (event) => {
                        console.error('Player error:', event.data);
                        this.status.textContent = 'Video error. Try another URL.';
                    }
                }
            });
        } catch (error) {
            console.error('Player creation error:', error);
            this.status.textContent = 'Failed to create player. Refresh and try again.';
        }
    }

    onPlayerStateChange(event) {
        if (this.syncInProgress || !this.playerReady) return;

        const state = event.data;
        
        // Only sync on play, pause, and buffering states
        if (state === YT.PlayerState.PLAYING || 
            state === YT.PlayerState.PAUSED || 
            state === YT.PlayerState.BUFFERING) {
            
            const currentTime = this.player.getCurrentTime();
            
            if (this.dataChannel && this.dataChannel.readyState === 'open') {
                const syncData = {
                    type: 'video-sync',
                    state: state,
                    currentTime: currentTime,
                    timestamp: Date.now()
                };
                
                this.dataChannel.send(JSON.stringify(syncData));
            }
        }
    }

    handleVideoSync(data) {
        if (!this.player || !this.playerReady) return;
        
        this.syncInProgress = true;
        
        const currentTime = this.player.getCurrentTime();
        const timeDiff = Math.abs(currentTime - data.currentTime);
        
        // Sync time if difference is significant (>1 second)
        if (timeDiff > 1) {
            this.player.seekTo(data.currentTime, true);
        }
        
        // Handle play/pause states
        setTimeout(() => {
            if (data.state === YT.PlayerState.PLAYING && this.player.getPlayerState() !== YT.PlayerState.PLAYING) {
                this.player.playVideo();
            } else if (data.state === YT.PlayerState.PAUSED && this.player.getPlayerState() !== YT.PlayerState.PAUSED) {
                this.player.pauseVideo();
            }
        }, 100);
        
        setTimeout(() => {
            this.syncInProgress = false;
        }, 500);
    }

    handleVideoLoad(videoId) {
        console.log('Peer shared video:', videoId);
        this.status.textContent = 'Peer shared a video. Loading...';
        
        if (this.player && this.playerReady) {
            this.player.loadVideoById(videoId);
        } else {
            this.createPlayer(videoId);
        }
        this.youtubeUrl.value = `https://www.youtube.com/watch?v=${videoId}`;
    }

    async toggleCameraAccess() {
        if (!this.cameraEnabled) {
            try {
                this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                this.localVideo.srcObject = this.localStream;
                this.cameraEnabled = true;
                this.toggleCamera.textContent = '🚫 Turn Off Camera';
                
                // Add tracks to peer connection
                if (this.peerConnection) {
                    this.localStream.getTracks().forEach(track => {
                        this.peerConnection.addTrack(track, this.localStream);
                    });
                    
                    // Renegotiate connection
                    if (this.peerConnection.connectionState === 'connected' && this.isInitiator) {
                        const offer = await this.peerConnection.createOffer();
                        await this.peerConnection.setLocalDescription(offer);
                        this.socket.emit('offer', {
                            roomId: this.roomId,
                            offer: offer
                        });
                    }
                }
            } catch (error) {
                console.error('Error accessing camera:', error);
                alert('Could not access camera. Please check permissions.');
            }
        } else {
            if (this.localStream) {
                this.localStream.getTracks().forEach(track => track.stop());
                this.localVideo.srcObject = null;
                this.localStream = null;
            }
            this.cameraEnabled = false;
            this.toggleCamera.textContent = '📹 Turn On Camera';
            this.remoteVideo.style.display = 'none';
            this.peerVideoPlaceholder.style.display = 'flex';
        }
    }
    
    checkYouTubeAPI() {
        let attempts = 0;
        const maxAttempts = 10;
        
        const check = () => {
            if (window.YT && window.YT.Player) {
                console.log('YouTube API confirmed loaded');
                return;
            }
            
            attempts++;
            if (attempts < maxAttempts) {
                console.log(`YouTube API not loaded, attempt ${attempts}/${maxAttempts}`);
                setTimeout(check, 1000);
            } else {
                console.log('YouTube API failed to load after maximum attempts');
                this.status.textContent = 'YouTube API failed to load. Please refresh the page.';
            }
        };
        
        check();
    }


}

// Global reference
window.watchTogether = null;

// Initialize YouTube API
function onYouTubeIframeAPIReady() {
    console.log('YouTube API ready');
    if (!window.watchTogether) {
        window.watchTogether = new WatchTogether();
    }
}

// Initialize when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded');
    if (!window.watchTogether) {
        window.watchTogether = new WatchTogether();
    }
});