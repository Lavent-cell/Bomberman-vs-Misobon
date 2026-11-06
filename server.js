// server.js
// 実行方法: npm start (または node server.js)
// 静的Webサーバー + WebSocketサーバー。部屋は1つだけ(部屋コードは環境変数 ROOM_CODE、既定 "main")。
// ゲームの進行は roomCore.js が行う。ここは通信と静的配信だけ。

import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";

import { createRoom } from "./roomCore.js";
import { resolveStaticPath } from "./staticPath.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const ROOM_CODE = process.env.ROOM_CODE || "main";
const COUNTDOWN_SEC = process.env.COUNTDOWN_SEC !== undefined ? Number(process.env.COUNTDOWN_SEC) : 3;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".txt": "text/plain; charset=utf-8"
};

const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end("Method Not Allowed");
    return;
  }
  const filePath = resolveStaticPath(__dirname, req.url);
  if (!filePath) {
    res.writeHead(404);
    res.end("Not Found");
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream" });
    res.end(req.method === "HEAD" ? undefined : data);
  });
});

const MAX_SPECTATORS = process.env.MAX_SPECTATORS !== undefined ? Number(process.env.MAX_SPECTATORS) : 10;

const room = createRoom({ roomCode: ROOM_CODE, countdownSec: COUNTDOWN_SEC, maxSpectators: MAX_SPECTATORS, log: (m) => console.log(`[部屋 ${ROOM_CODE}] ${m}`) });
const wss = new WebSocketServer({
  server,
  maxPayload: 4096,
  verifyClient: ({ req, origin }) => {
    // Reject cross-origin browser WebSocket connections.
    if (!origin) return true; // Retain compatibility with non-browser clients.
    try {
      const url = new URL(origin);
      return (url.protocol === "https:" || url.protocol === "http:") && url.host === req.headers.host;
    } catch (_) { return false; }
  }
});

wss.on("connection", (ws, req) => {
  ws.on("error", () => {});
  try {
    const url = new URL(req.url, "http://localhost");
    const accepted = room.handleConnection(ws, {
      token: url.searchParams.get("token"),
      version: url.searchParams.get("v"),
      room: url.searchParams.get("room") || ROOM_CODE,
      spectate: url.searchParams.get("spectate") === "1"
    });
    if (!accepted) return;
    ws.on("message", (raw) => {
      try {
        room.handleMessage(ws, raw.toString());
      } catch (error) {
        console.error("[WebSocket] Message handling failed:", error);
        ws.terminate();
      }
    });
    ws.on("close", () => room.leave(ws));
  } catch (error) {
    console.error("[WebSocket] Connection handling failed:", error);
    ws.terminate();
  }
});

server.listen(PORT, () => {
  console.log("==========================================");
  console.log(`Bomberman vs Misobon サーバー起動 (PORT: ${PORT})`);
  console.log(`URL: http://localhost:${PORT}/?room=${ROOM_CODE}`);
  console.log("==========================================");
});
