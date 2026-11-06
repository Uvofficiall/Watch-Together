class WatchTogether {
    constructor() {
        this.socket = io();
        this.peerConnection = null;
        this.dataChannel = null;
        this.player = null;
        this.roomId = null;
        this.isInitiator = false;
        this.isPolite = false;
        this.makingOffer = false;
        this.iceCandidateQueue = [];
        this.syncInProgress = false;
        this.playerReady = false;
        this.username = '';
        this.localStream = null;
        this.remoteStream = null;
        this.cameraEnabled = false;
        this.recentMessageIds = new Set();
        
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
        this.connectBtn.addEventListener('click', () => this.initiateConnection(true));
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
        const roomId = (this.roomInput.value.trim() || Math.random().toString(36).substr(2, 9)).toUpperCase();
        this.roomId = roomId;
        this.roomInput.value = roomId;

        // Reset peer connection state
        this.resetPeerConnection();

        this.socket.emit('join-room', roomId);
        this.roomStatus.textContent = `${name} connecting to room: ${roomId}...`;
        this.status.textContent = 'Joining room...';
        this.connectBtn.disabled = true;
    }

    resetPeerConnection() {
        if (this.peerConnection) {
            try {
                this.peerConnection.close();
            } catch (e) {
                console.log('Error closing peer connection:', e);
            }
            this.peerConnection = null;
        }
        this.dataChannel = null;
        this.iceCandidateQueue = [];
        this.makingOffer = false;
        this.setupWebRTC();
    }

    setupSocketEvents() {
        this.socket.on('joined-room', (roomId) => {
            this.roomId = roomId;
            this.roomStatus.textContent = `Connected to room: ${roomId}`;
            this.status.textContent = 'Waiting for peer to join...';
            this.connectBtn.disabled = true;
            this.connectBtn.textContent = 'Connect to Peer';
        });

        this.socket.on('room-full', () => {
            this.roomStatus.textContent = 'Room is full (max 2 users). Please try another room ID.';
            this.status.textContent = 'Room is full.';
            this.connectBtn.disabled = true;
        });

        this.socket.on('peer-joined', (data) => {
            console.log('Peer joined:', data);
            // If data is provided by updated server, use it. Otherwise first joiner is initiator.
            this.isInitiator = data ? !!data.isInitiator : true;
            this.isPolite = !this.isInitiator;
            this.roomStatus.textContent = `Both users connected in room: ${this.roomId}!`;
            this.connectBtn.disabled = false;
            this.connectBtn.textContent = 'Connect to Peer';

            // Enable chat immediately via server relay
            this.chatInput.disabled = false;

            if (this.isInitiator) {
                this.status.textContent = 'Peer joined! Connecting P2P...';
                setTimeout(() => {
                    this.initiateConnection();
                }, 400);
            } else {
                this.status.textContent = 'Peer joined! Establishing P2P connection...';
            }
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
            this.status.textContent = 'Peer disconnected. Waiting for a peer to join...';
            this.roomStatus.textContent = `Peer left room: ${this.roomId}`;
            this.chatInput.disabled = true;
            this.connectBtn.disabled = true;
            this.connectBtn.textContent = 'Connect to Peer';
            this.remoteVideo.style.display = 'none';
            this.peerVideoPlaceholder.style.display = 'flex';
            this.peerVideoPlaceholder.textContent = 'Waiting for peer video...';
            this.resetPeerConnection();
        });

        // Socket.io relay fallbacks (for when WebRTC data channel is negotiating or restricted)
        this.socket.on('chat-message', (data) => {
            if (this.isDuplicateMessage(data.msgId)) return;
            this.displayMessage(data.username, data.message, data.timestamp);
        });

        this.socket.on('video-sync', (data) => {
            if (this.isDuplicateMessage(data.msgId)) return;
            this.handleVideoSync(data);
        });

        this.socket.on('video-load', (data) => {
            if (this.isDuplicateMessage(data.msgId)) return;
            this.handleVideoLoad(data.videoId);
        });

        this.socket.on('camera-toggle', (data) => {
            if (data.type === 'camera-on') {
                this.peerVideoPlaceholder.textContent = 'Waiting for peer video...';
            } else if (data.type === 'camera-off') {
                this.remoteVideo.style.display = 'none';
                this.peerVideoPlaceholder.style.display = 'flex';
                this.peerVideoPlaceholder.textContent = 'Peer camera is off';
            }
        });
    }

    isDuplicateMessage(msgId) {
        if (!msgId) return false;
        if (this.recentMessageIds.has(msgId)) return true;
        this.recentMessageIds.add(msgId);
        if (this.recentMessageIds.size > 200) {
            const first = this.recentMessageIds.values().next().value;
            this.recentMessageIds.delete(first);
        }
        return false;
    }

    setupWebRTC() {
        const config = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
                { urls: 'stun:stun.cloudflare.com:3478' },
                { urls: 'stun:stun.services.mozilla.com' }
            ]
        };

        this.peerConnection = new RTCPeerConnection(config);

        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                const candidateJSON = event.candidate.toJSON ? event.candidate.toJSON() : {
                    candidate: event.candidate.candidate,
                    sdpMid: event.candidate.sdpMid,
                    sdpMLineIndex: event.candidate.sdpMLineIndex,
                    usernameFragment: event.candidate.usernameFragment
                };
                this.socket.emit('ice-candidate', {
                    roomId: this.roomId,
                    candidate: candidateJSON
                });
            }
        };

        this.peerConnection.ondatachannel = (event) => {
            console.log('Received remote data channel:', event.channel.label);
            this.setupDataChannel(event.channel);
        };

        this.peerConnection.ontrack = (event) => {
            console.log('Received remote track:', event.track.kind);
            let stream = event.streams && event.streams[0];
            if (!stream) {
                if (!this.remoteStream) {
                    this.remoteStream = new MediaStream();
                }
                this.remoteStream.addTrack(event.track);
                stream = this.remoteStream;
            } else {
                this.remoteStream = stream;
            }

            this.remoteVideo.srcObject = stream;
            this.remoteVideo.style.display = 'block';
            this.peerVideoPlaceholder.style.display = 'none';

            event.track.onended = () => {
                if (this.remoteStream && this.remoteStream.getTracks().every(t => t.readyState === 'ended')) {
                    this.remoteVideo.style.display = 'none';
                    this.peerVideoPlaceholder.style.display = 'flex';
                    this.peerVideoPlaceholder.textContent = 'Peer camera is off';
                }
            };
        };

        this.peerConnection.onconnectionstatechange = () => {
            const state = this.peerConnection.connectionState;
            console.log('WebRTC Connection state:', state);
            if (state === 'connected') {
                this.status.textContent = 'WebRTC Connected! (Direct P2P active)';
                this.chatInput.disabled = false;
                this.connectBtn.disabled = true;
                this.connectBtn.textContent = 'Connected';
            } else if (state === 'disconnected') {
                this.status.textContent = 'P2P Disconnected. Operating via Relay.';
                this.connectBtn.disabled = false;
                this.connectBtn.textContent = 'Connect to Peer';
            } else if (state === 'failed') {
                console.log('P2P connection state failed. Fallback to relay active.');
                this.status.textContent = 'Connected via Server Relay. You can chat & sync!';
                this.connectBtn.disabled = false;
                this.connectBtn.textContent = 'Retry P2P Connection';
                this.chatInput.disabled = false;
            }
        };

        this.peerConnection.oniceconnectionstatechange = () => {
            const iceState = this.peerConnection.iceConnectionState;
            console.log('ICE connection state:', iceState);
            if (iceState === 'connected' || iceState === 'completed') {
                this.status.textContent = 'WebRTC Connected! (Direct P2P active)';
                this.chatInput.disabled = false;
                this.connectBtn.disabled = true;
                this.connectBtn.textContent = 'Connected';
            }
        };

        // Attach existing local camera stream tracks if active
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                this.peerConnection.addTrack(track, this.localStream);
            });
        }
    }

    async initiateConnection(isManualRetry = false) {
        if (!this.roomId) {
            alert('Please join a room first!');
            return;
        }

        try {
            this.connectBtn.disabled = true;
            this.connectBtn.textContent = 'Connecting...';
            this.status.textContent = 'Connecting to peer...';

            if (!this.peerConnection || 
                this.peerConnection.connectionState === 'closed' || 
                this.peerConnection.connectionState === 'failed' ||
                this.peerConnection.signalingState !== 'stable') {
                this.resetPeerConnection();
            }

            // Create data channel on initiator side
            this.dataChannel = this.peerConnection.createDataChannel('chat', {
                negotiated: false
            });
            this.setupDataChannel(this.dataChannel);

            this.makingOffer = true;
            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);
            
            this.socket.emit('offer', {
                roomId: this.roomId,
                offer: {
                    type: offer.type,
                    sdp: offer.sdp
                }
            });
            
            this.status.textContent = 'Offer sent, establishing connection...';
        } catch (error) {
            console.error('Error initiating connection:', error);
            this.status.textContent = 'Connected via Relay. You can chat & sync!';
            this.connectBtn.disabled = false;
            this.connectBtn.textContent = 'Connect to Peer';
        } finally {
            this.makingOffer = false;
        }
    }

    async handleOffer(offer) {
        if (!offer || !offer.sdp) return;
        try {
            // Collision handling (Perfect Negotiation pattern)
            const isCollision = this.makingOffer || this.peerConnection.signalingState !== 'stable';
            
            if (isCollision) {
                if (!this.isPolite) {
                    console.log('Offer collision detected. Impolite peer ignoring offer.');
                    return;
                }
                console.log('Offer collision detected. Polite peer rolling back.');
                await this.peerConnection.setLocalDescription({ type: 'rollback' });
            }

            const offerDesc = new RTCSessionDescription(offer);
            await this.peerConnection.setRemoteDescription(offerDesc);

            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);
            
            this.socket.emit('answer', {
                roomId: this.roomId,
                answer: {
                    type: answer.type,
                    sdp: answer.sdp
                }
            });

            // Process queued candidates after both remoteDescription and localDescription are set!
            await this.processIceQueue();

            this.status.textContent = 'Connecting to peer...';
        } catch (error) {
            console.error('Error handling offer:', error);
            this.status.textContent = 'Connected via Relay. You can chat & sync!';
            this.connectBtn.disabled = false;
            this.connectBtn.textContent = 'Connect to Peer';
        }
    }

    async handleAnswer(answer) {
        if (!answer || !answer.sdp) return;
        try {
            if (this.peerConnection.signalingState !== 'have-local-offer') {
                console.warn('Ignoring answer in unexpected state:', this.peerConnection.signalingState);
                return;
            }
            const answerDesc = new RTCSessionDescription(answer);
            await this.peerConnection.setRemoteDescription(answerDesc);
            
            // Process queued candidates after remote description is set on initiator
            await this.processIceQueue();
        } catch (error) {
            console.error('Error handling answer:', error);
        }
    }

    async handleIceCandidate(candidate) {
        if (!candidate) return;

        // Extract candidate dictionary if nested
        const cand = (candidate.candidate && typeof candidate.candidate === 'object')
            ? candidate.candidate
            : candidate;

        if (!cand) return;

        try {
            // Only add candidate directly if both remoteDescription and localDescription are set
            if (this.peerConnection && 
                this.peerConnection.remoteDescription && 
                this.peerConnection.localDescription) {
                await this.peerConnection.addIceCandidate(cand);
            } else {
                // Otherwise queue until descriptions are ready
                this.iceCandidateQueue.push(cand);
            }
        } catch (error) {
            console.error('Error adding ICE candidate:', error);
        }
    }

    async processIceQueue() {
        if (!this.peerConnection || !this.peerConnection.remoteDescription || !this.peerConnection.localDescription) {
            return;
        }
        while (this.iceCandidateQueue.length > 0) {
            const cand = this.iceCandidateQueue.shift();
            try {
                if (cand && (cand.candidate !== undefined || typeof cand === 'string')) {
                    await this.peerConnection.addIceCandidate(cand);
                }
            } catch (error) {
                console.error('Error processing queued ICE candidate:', error);
            }
        }
    }

    setupDataChannel(channel) {
        if (!channel) return;
        this.dataChannel = channel;
        
        channel.onopen = () => {
            console.log('Data channel opened successfully');
            this.status.textContent = 'WebRTC Connected! (Direct P2P active)';
            this.chatInput.disabled = false;
            this.connectBtn.disabled = true;
            this.connectBtn.textContent = 'Connected';
            
            setTimeout(() => {
                if (!this.remoteVideo.srcObject) {
                    this.peerVideoPlaceholder.textContent = 'Peer camera is off';
                }
            }, 2000);
        };

        channel.onclose = () => {
            console.log('Data channel closed');
            this.connectBtn.disabled = false;
            this.connectBtn.textContent = 'Connect to Peer';
        };

        channel.onerror = (err) => {
            console.error('Data channel error:', err);
        };

        channel.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (this.isDuplicateMessage(data.msgId)) return;
                
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
                console.error('Error parsing data channel message:', error);
            }
        };
    }

    generateMsgId() {
        return Math.random().toString(36).substr(2, 9) + Date.now();
    }

    sendMessage() {
        const message = this.chatInput.value.trim();
        if (!message) return;
        
        const msgId = this.generateMsgId();
        const data = {
            type: 'chat',
            msgId: msgId,
            username: this.username || 'Anonymous',
            message: message,
            timestamp: new Date().toLocaleTimeString(),
            roomId: this.roomId
        };

        this.recentMessageIds.add(msgId);

        // Send via WebRTC data channel if open, otherwise fallback to Socket.io relay
        let sent = false;
        if (this.dataChannel && this.dataChannel.readyState === 'open') {
            try {
                this.dataChannel.send(JSON.stringify(data));
                sent = true;
            } catch (e) {
                console.warn('Data channel send failed, falling back to socket relay:', e);
            }
        }

        if (!sent && this.socket && this.roomId) {
            this.socket.emit('chat-message', data);
        }

        this.displayMessage(this.username || 'You', message, data.timestamp);
        this.chatInput.value = '';
    }

    displayMessage(username, message, timestamp) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message';
        
        const headerDiv = document.createElement('div');
        const strong = document.createElement('strong');
        strong.textContent = username;
        const timeSpan = document.createElement('span');
        timeSpan.className = 'message-time';
        timeSpan.textContent = ` ${timestamp}`;
        headerDiv.appendChild(strong);
        headerDiv.appendChild(timeSpan);
        
        const bodyDiv = document.createElement('div');
        bodyDiv.textContent = message;
        
        messageDiv.appendChild(headerDiv);
        messageDiv.appendChild(bodyDiv);
        
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
        
        this.createPlayer(videoId);
        
        const msgId = this.generateMsgId();
        const data = {
            type: 'video-load',
            msgId: msgId,
            videoId: videoId,
            roomId: this.roomId
        };

        this.recentMessageIds.add(msgId);

        // Send via data channel if open, else socket relay
        let sent = false;
        if (this.dataChannel && this.dataChannel.readyState === 'open') {
            try {
                this.dataChannel.send(JSON.stringify(data));
                sent = true;
            } catch (e) {
                console.warn('Data channel send error:', e);
            }
        }

        if (!sent && this.socket && this.roomId) {
            this.socket.emit('video-load', data);
        }
    }

    extractVideoId(url) {
        // Direct 11-char ID
        if (/^[a-zA-Z0-9_-]{11}$/.test(url)) {
            return url;
        }

        const patterns = [
            /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
            /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
            /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
            /(?:youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
            /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
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
        if (!window.YT || !window.YT.Player) {
            setTimeout(() => this.createPlayer(videoId), 500);
            return;
        }
        
        if (this.player && typeof this.player.destroy === 'function') {
            try {
                this.player.destroy();
            } catch (e) {
                console.log('Player destroy error (ignored):', e);
            }
        }
        
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
        if (this.syncInProgress || !this.playerReady || !this.player || typeof this.player.getCurrentTime !== 'function') return;

        const state = event.data;
        
        // Only sync on play, pause, and buffering states
        if (state === YT.PlayerState.PLAYING || 
            state === YT.PlayerState.PAUSED || 
            state === YT.PlayerState.BUFFERING) {
            
            try {
                const currentTime = this.player.getCurrentTime();
                const msgId = this.generateMsgId();
                const syncData = {
                    type: 'video-sync',
                    msgId: msgId,
                    state: state,
                    currentTime: currentTime,
                    timestamp: Date.now(),
                    roomId: this.roomId
                };

                this.recentMessageIds.add(msgId);

                let sent = false;
                if (this.dataChannel && this.dataChannel.readyState === 'open') {
                    try {
                        this.dataChannel.send(JSON.stringify(syncData));
                        sent = true;
                    } catch (e) {
                        console.warn('Data channel send error:', e);
                    }
                }

                if (!sent && this.socket && this.roomId) {
                    this.socket.emit('video-sync', syncData);
                }
            } catch (e) {
                console.error('Error sending video sync:', e);
            }
        }
    }

    handleVideoSync(data) {
        if (!this.player || !this.playerReady || typeof this.player.getCurrentTime !== 'function') return;
        
        this.syncInProgress = true;
        
        try {
            const currentTime = this.player.getCurrentTime();
            const timeDiff = Math.abs(currentTime - data.currentTime);
            
            // Sync time if difference is significant (>1.5 second)
            if (timeDiff > 1.5) {
                this.player.seekTo(data.currentTime, true);
            }
            
            setTimeout(() => {
                try {
                    if (data.state === YT.PlayerState.PLAYING && this.player.getPlayerState() !== YT.PlayerState.PLAYING) {
                        this.player.playVideo();
                    } else if (data.state === YT.PlayerState.PAUSED && this.player.getPlayerState() !== YT.PlayerState.PAUSED) {
                        this.player.pauseVideo();
                    }
                } catch (e) {
                    console.error('Error applying playback state:', e);
                }
            }, 100);
        } catch (e) {
            console.error('Error handling video sync:', e);
        }
        
        setTimeout(() => {
            this.syncInProgress = false;
        }, 500);
    }

    handleVideoLoad(videoId) {
        console.log('Peer shared video:', videoId);
        this.status.textContent = 'Peer shared a video. Loading...';
        
        if (this.player && this.playerReady && typeof this.player.loadVideoById === 'function') {
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
                }

                const data = { type: 'camera-on', roomId: this.roomId };
                if (this.dataChannel && this.dataChannel.readyState === 'open') {
                    try {
                        this.dataChannel.send(JSON.stringify(data));
                    } catch (e) {
                        console.error('Error sending camera-on via data channel:', e);
                    }
                }
                if (this.socket && this.roomId) {
                    this.socket.emit('camera-toggle', data);
                }
            } catch (error) {
                console.error('Error accessing camera:', error);
                alert('Could not access camera. Please check camera permissions.');
            }
        } else {
            if (this.localStream) {
                if (this.peerConnection) {
                    const senders = this.peerConnection.getSenders();
                    this.localStream.getTracks().forEach(track => {
                        const sender = senders.find(s => s.track === track);
                        if (sender) {
                            try {
                                this.peerConnection.removeTrack(sender);
                            } catch (e) {
                                console.error('Error removing track from sender:', e);
                            }
                        }
                        track.stop();
                    });
                } else {
                    this.localStream.getTracks().forEach(track => track.stop());
                }
                this.localVideo.srcObject = null;
                this.localStream = null;
            }
            this.cameraEnabled = false;
            this.toggleCamera.textContent = '📹 Turn On Camera';
            this.remoteVideo.style.display = 'none';
            this.peerVideoPlaceholder.style.display = 'flex';
            this.peerVideoPlaceholder.textContent = 'Peer camera is off';

            const data = { type: 'camera-off', roomId: this.roomId };
            if (this.dataChannel && this.dataChannel.readyState === 'open') {
                try {
                    this.dataChannel.send(JSON.stringify(data));
                } catch (e) {
                    console.error('Error sending camera-off via data channel:', e);
                }
            }
            if (this.socket && this.roomId) {
                this.socket.emit('camera-toggle', data);
            }
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

// Initialize YouTube API callback
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
