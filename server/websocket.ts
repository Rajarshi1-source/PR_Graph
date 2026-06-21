import { createServer } from "node:http";
import next from "next";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { pub, sub } from "@/lib/cache/redis";
import { setIO } from "@/lib/websocket/server";
import { getCachedGraph } from "@/lib/cache/graphCache";
import { runWorker } from "@/lib/events/worker";
import { env } from "@/lib/env";

// Custom server: hosts the Next request handler AND the Socket.IO server in one process
// (App Router route handlers cannot hold long-lived WebSocket connections). This file is NOT
// processed by the Next compiler — run it with tsx (dev) or the esbuild bundle (prod).
const dev = env.NODE_ENV !== "production";
const app = next({ dev });
await app.prepare(); // Next 16 compiles with Turbopack internally here (dev)

const handle = app.getRequestHandler();
const httpServer = createServer((req, res) => handle(req, res));

const io = new Server(httpServer, { path: "/api/socket" });
io.adapter(createAdapter(pub, sub)); // multi-replica fan-out via Redis Pub/Sub
setIO(io);

io.on("connection", (socket) => {
  socket.on("graph:subscribe", async (repoId: string) => {
    socket.join(`repo:${repoId}`);
    const graph = await getCachedGraph(Number(repoId));
    if (graph) socket.emit("graph:current", graph); // snapshot on subscribe (§B.4)
  });
  socket.on("graph:unsubscribe", (repoId: string) => socket.leave(`repo:${repoId}`));
});

httpServer.listen(env.PORT, () => {
  console.log(`▶ PRGraph (Next + Socket.IO) on http://localhost:${env.PORT}`);
});

// Webhook recompute worker runs in the same process (bulkhead concurrency in the worker).
runWorker(`worker-${process.pid}`).catch((err) => {
  console.error("[worker] fatal:", err);
});
