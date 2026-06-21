import type { Server } from "socket.io";

/**
 * Holds the Socket.IO server instance (created by the custom server, server/websocket.ts)
 * so other modules (the recompute worker) can push updates without importing the server file.
 */
let io: Server | null = null;

export function setIO(server: Server): void {
  io = server;
}

export function getIO(): Server | null {
  return io;
}

/** Push a recomputed graph (+ diff) to everyone watching this repo's room. */
export function pushGraphUpdate(repoId: number, payload: unknown): void {
  io?.to(`repo:${repoId}`).emit("graph:updated", payload);
}
