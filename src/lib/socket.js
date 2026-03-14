import { Server } from 'socket.io';

let io;

export const init = (httpServer) => {
    console.log('🔧 Initializing Socket.io...');

    io = new Server(httpServer, {
        path: '/socket.io/', // Explicitly set the path
        cors: {
            origin: [
                'https://novaconsumables.co.uk',
                'https://www.novaconsumables.co.uk',
                'http://localhost:5173'
            ],
            methods: ["GET", "POST"],
            credentials: true
        },
        // Important for production with nginx
        transports: ['polling', 'websocket'],
        // Add ping settings for stability
        pingTimeout: 60000,
        pingInterval: 25000
    });

    console.log('✅ Socket.io server created');
    console.log('📡 Path:', io.path());
    console.log('📡 Transports:', io.opts.transports);

    io.on('connection', (socket) => {
        console.log(`🔌 New client connected: ${socket.id} from ${socket.handshake.address}`);

        socket.on('disconnect', (reason) => {
            console.log(`🔌 Client disconnected: ${socket.id}, reason: ${reason}`);
        });

        socket.on('error', (error) => {
            console.error(`❌ Socket error for ${socket.id}:`, error);
        });
    });

    // Log engine errors
    io.engine.on('connection_error', (err) => {
        console.error('❌ Engine connection error:', err);
    });

    return io;
};

export const getIO = () => {
    if (!io) {
        throw new Error('Socket.io not initialized!');
    }
    return io;
};