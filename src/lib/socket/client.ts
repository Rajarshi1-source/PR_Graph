"use client";

import { io, type Socket } from "socket.io-client";

/**
 * Browser Socket.IO singleton. Connects to the custom server's `/api/socket` path. Reused
 * across components so repeated mounts share one connection.
 */
let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io({ path: "/api/socket", transports: ["websocket"], autoConnect: true });
  }
  return socket;
}
