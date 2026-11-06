const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-room', (roomId) => {
    if (!roomId) return;

    // Leave any previous room
    if (socket.roomId && socket.roomId !== roomId && rooms.has(socket.roomId)) {
      const prevRoom = rooms.get(socket.roomId);
      prevRoom.delete(socket.id);
      socket.leave(socket.roomId);
      if (prevRoom.size === 0) {
        rooms.delete(socket.roomId);
      } else {
        socket.to(socket.roomId).emit('peer-disconnected');
      }
    }

    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }
    
    const room = rooms.get(roomId);
    
    if (!room.has(socket.id) && room.size >= 2) {
      socket.emit('room-full');
      return;
    }
    
    socket.join(roomId);
    room.add(socket.id);
    socket.roomId = roomId;
    
    socket.emit('joined-room', roomId);
    
    if (room.size === 2) {
      // First user who was waiting in the room becomes initiator
      socket.to(roomId).emit('peer-joined', { isInitiator: true });
      // Second user who just joined is receiver
      socket.emit('peer-joined', { isInitiator: false });
    }
  });

  socket.on('offer', (data) => {
    const roomId = (data && data.roomId) || socket.roomId;
    if (roomId) {
      socket.to(roomId).emit('offer', data.offer);
    }
  });

  socket.on('answer', (data) => {
    const roomId = (data && data.roomId) || socket.roomId;
    if (roomId) {
      socket.to(roomId).emit('answer', data.answer);
    }
  });

  socket.on('ice-candidate', (data) => {
    const roomId = (data && data.roomId) || socket.roomId;
    if (roomId) {
      socket.to(roomId).emit('ice-candidate', data.candidate);
    }
  });

  // Relay fallbacks for chat, video sync, video load, and camera events
  socket.on('chat-message', (data) => {
    const roomId = (data && data.roomId) || socket.roomId;
    if (roomId) {
      socket.to(roomId).emit('chat-message', data);
    }
  });

  socket.on('video-sync', (data) => {
    const roomId = (data && data.roomId) || socket.roomId;
    if (roomId) {
      socket.to(roomId).emit('video-sync', data);
    }
  });

  socket.on('video-load', (data) => {
    const roomId = (data && data.roomId) || socket.roomId;
    if (roomId) {
      socket.to(roomId).emit('video-load', data);
    }
  });

  socket.on('camera-toggle', (data) => {
    const roomId = (data && data.roomId) || socket.roomId;
    if (roomId) {
      socket.to(roomId).emit('camera-toggle', data);
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    if (socket.roomId && rooms.has(socket.roomId)) {
      const room = rooms.get(socket.roomId);
      room.delete(socket.id);
      if (room.size === 0) {
        rooms.delete(socket.roomId);
      } else {
        socket.to(socket.roomId).emit('peer-disconnected');
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
