import { Server } from 'socket.io';

let io;

export const init = (httpServer) => {
    io = new Server(httpServer, {
        cors: {
            origin: "*", // Adjust this for production if needed
            methods: ["GET", "POST"]
        }
    });

    io.on('connection', (socket) => {
        console.log(`🔌 New client connected: ${socket.id}`);

        socket.on('disconnect', () => {
            console.log(`🔌 Client disconnected: ${socket.id}`);
        });
    });

    return io;
};

export const getIO = () => {
    if (!io) {
        throw new Error('Socket.io not initialized!');
    }
    return io;
};