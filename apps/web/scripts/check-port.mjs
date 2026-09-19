#!/usr/bin/env node
/**
 * Pre-flight guard for `npm run dev` (apps/web). Next.js's own dev server
 * silently auto-increments past an occupied port ("Port 3000 is in use,
 * using available port 3001 instead") rather than failing — that's exactly
 * how a stray/duplicate `next dev` process ends up serving the app from an
 * unexpected port (e.g. 3002) that the backend's CORS `origin` allowlist
 * (apps/api's `FRONTEND_URL`, default `http://localhost:3000`) was never
 * told about, producing a browser-side CORS error even though the API
 * itself is healthy. This script checks the target port itself,
 * immediately before Next starts, and exits with a clear error instead of
 * letting that happen silently.
 *
 * Deliberately checks by CONNECTING to the port, not by trying to bind it:
 * on Windows, `net.Server.listen()` does not set `SO_EXCLUSIVEADDRUSE` by
 * default, so a second process can often successfully bind() the same port
 * another process is already listening on (confirmed empirically on this
 * machine — a bind-based check silently reported an occupied port as
 * free). Attempting an actual TCP connection is what reliably detects "is
 * something already answering here" across platforms.
 */
import net from 'net';

const port = Number(process.argv[2] || 3000);
const TIMEOUT_MS = 800;

const socket = new net.Socket();
let settled = false;

function occupied() {
  if (settled) return;
  settled = true;
  socket.destroy();
  console.error(`\nPort ${port} is already in use.\n`);
  console.error(
    `Refusing to start — the dev server would otherwise silently move to a different port,`,
  );
  console.error(
    `which the backend's CORS allowlist (FRONTEND_URL) does not expect and will reject.\n`,
  );
  console.error(`Find and stop whatever is already listening on port ${port}, then retry.\n`);
  process.exit(1);
}

function free() {
  if (settled) return;
  settled = true;
  socket.destroy();
  process.exit(0);
}

socket.setTimeout(TIMEOUT_MS);
socket.once('connect', occupied);
socket.once('timeout', free);
socket.once('error', (err) => {
  if (err && (err.code === 'ECONNREFUSED' || err.code === 'EHOSTUNREACH')) {
    free();
  } else {
    // Any other connection error also means nothing usable is listening.
    free();
  }
});

socket.connect(port, '127.0.0.1');
