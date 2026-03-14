import { Server } from "socket.io";

let io;

export const init = (httpServer) => {
    io = new Server(httpServer, {
        path: "/socket.io",
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        },
        transports: ["websocket", "polling"]
    });

    io.on("connection", (socket) => {
        console.log("🔌 New client connected:", socket.id);

        socket.on("disconnect", () => {
            console.log("🔌 Client disconnected:", socket.id);
        });
    });

    return io;
};

export const getIO = () => {
    if (!io) throw new Error("Socket.io not initialized!");
    return io;
};