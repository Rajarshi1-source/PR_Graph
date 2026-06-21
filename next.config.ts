import type { NextConfig } from "next";

// PRGraph runs a CUSTOM server (server/websocket.ts) that hosts the Next request
// handler AND the Socket.IO server in one process. Do NOT set `output: 'standalone'`:
// it emits Next's own minimal server which drops the Socket.IO layer (see plan §9.1).
const nextConfig: NextConfig = {
  // output: 'standalone',   // intentionally omitted — incompatible with the custom server
  // reactCompiler: true,    // optional (stable in 16, off by default; adds build time)
  outputFileTracingIncludes: {
    "/api/**": ["./prisma/**"],
  },
};

export default nextConfig;
