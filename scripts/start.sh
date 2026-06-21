#!/bin/sh
set -e

echo "Running database migrations..."
node_modules/.bin/prisma migrate deploy   # prisma CLI is a prod dependency (offline, no npx fetch)

echo "Starting PRGraph custom server (Next + Socket.IO)..."
exec node dist/server.mjs                  # the compiled custom server — NOT .next/standalone/server.js
