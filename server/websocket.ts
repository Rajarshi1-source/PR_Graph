import { createServer } from "node:http";
import next from "next";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { pub, sub } from "@/lib/cache/redis";
import { setIO } from "@/lib/websocket/server";
import { getCachedGraph } from "@/lib/cache/graphCache";
import { runWorker } from "@/lib/events/worker";
import { startReconciliation } from "@/lib/events/reconcile";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { env } from "@/lib/env";

/** Minimal cookie-header parser (avoids a dependency for the one cookie we need). */
function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

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

// Authenticate the handshake from the signed session cookie (security-and-api.md §B.4): a socket
// with no valid session can connect but cannot subscribe to any repo room.
io.use((socket, nextFn) => {
  const token = parseCookie(socket.handshake.headers.cookie, SESSION_COOKIE);
  const session = verifySessionToken(token);
  socket.data.userId = session?.userId ?? null;
  nextFn();
});

io.on("connection", (socket) => {
  socket.on("graph:subscribe", async (repoId: string) => {
    const userId = socket.data.userId as number | null;
    if (!userId) {
      socket.emit("graph:error", { detail: "Not authenticated" });
      return;
    }
    const id = Number(repoId);
    if (!Number.isInteger(id)) return;

    // Authorize: the user must own this repo (via their installation).
    const owned = await prisma.repository.findFirst({
      where: { id, installation: { userId } },
      select: { id: true },
    });
    if (!owned) {
      socket.emit("graph:error", { detail: "Not authorized for this repo" });
      return;
    }

    socket.join(`repo:${repoId}`);
    const graph = await getCachedGraph(id);
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

// Safety net for dropped webhooks: periodically recompute stale repos.
startReconciliation();
