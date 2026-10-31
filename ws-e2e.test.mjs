// 実際の ws サーバー(server.js)を起動して、2つのクライアントで通しで確かめる。
// ws が入っていない環境(npm install 前)では自動でスキップする。
import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PROTOCOL_VERSION } from "../js/protocol.js";
import { sleep, waitFor } from "./helpers.mjs";

let WebSocket = null;
try { ({ WebSocket } = await import("ws")); } catch (e) { /* skip */ }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 20000 + Math.floor(Math.random() * 20000);

function startServer() {
  const child = spawn(process.execPath, ["server.js"], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), COUNTDOWN_SEC: "0" } });
  return new Promise((resolve, reject) => {
    child.stdout.on("data", (d) => { if (String(d).includes("起動")) resolve(child); });
    child.stderr.on("data", (d) => process.stderr.write(d));
    child.on("exit", (c) => reject(new Error("server exited " + c)));
    setTimeout(() => reject(new Error("server start timeout")), 8000);
  });
}

function rawGet(requestPath) {
  return new Promise((resolve) => {
    const sock = net.connect(PORT, "127.0.0.1", () => sock.write(`GET ${requestPath} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`));
    let buf = "";
    sock.on("data", (d) => { buf += d; });
    sock.on("close", () => resolve(buf));
  });
}

function client(token, params = {}) {
  const q = new URLSearchParams({ room: "main", token, v: PROTOCOL_VERSION, ...params });
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/?${q}`);
  const c = { ws, inbox: [], closed: false };
  ws.on("message", (raw) => c.inbox.push(JSON.parse(raw.toString())));
  ws.on("close", () => { c.closed = true; });
  c.open = new Promise((res) => ws.on("open", res));
  c.send = (o) => ws.send(JSON.stringify(o));
  c.last = (t) => [...c.inbox].reverse().find((m) => m.type === t) || null;
  c.errors = () => c.inbox.filter((m) => m.type === "ERROR").map((m) => m.code);
  return c;
}

test("実サーバー: 静的配信・参加・試合開始・移動・切断復帰・満員・バージョン不一致", { skip: !WebSocket && "ws が未インストール(npm install 後に実行されます)" }, async (t) => {
  const server = await startServer();
  t.after(() => server.kill());

  // 静的配信: 通常ファイルは返し、../ やサーバー本体は返さない
  assert.match(await rawGet("/"), /^HTTP\/1\.1 200/);
  assert.match(await rawGet("/js/state.js"), /^HTTP\/1\.1 200/);
  for (const p of ["/../server.js", "/js/../server.js", "/%2e%2e/server.js", "/server.js", "/package.json", "/roomCore.js"]) {
    const res = await rawGet(p);
    assert.match(res, /^HTTP\/1\.1 404/, `${p} が配信されている`);
    assert.doesNotMatch(res, /createRoom|WebSocketServer/, `${p} でサーバーのコードが漏れている`);
  }

  // バージョン不一致
  const old = client("tok_old_client_1", { v: "1.0.0" });
  await waitFor(() => old.closed);
  assert.deepEqual(old.errors(), ["VERSION_MISMATCH"]);

  // 部屋コード違い
  const wrong = client("tok_wrong_room_1", { room: "nope" });
  await waitFor(() => wrong.closed);
  assert.deepEqual(wrong.errors(), ["ROOM_NOT_FOUND"]);

  const a = client("tok_player_aaaa"); const b = client("tok_player_bbbb");
  await Promise.all([a.open, b.open]);
  await waitFor(() => a.last("INIT") && b.last("INIT") && a.last("SNAPSHOT"));
  assert.equal(a.last("INIT").assignedCharKey, "b0");
  assert.equal(b.last("INIT").assignedCharKey, "m0");

  b.send({ type: "START" });
  await waitFor(() => b.errors().includes("NOT_HOST"));
  a.send({ type: "START" });
  await waitFor(() => a.last("SNAPSHOT")?.phase === "playing");

  // 押しっぱなしで動く(クライアントは方向を1回送るだけ)
  const x0 = a.last("SNAPSHOT").bombermen[0].x;
  a.send({ type: "INPUT", action: "HOLD_DIR", params: { dx: 1, dy: 0 } });
  await waitFor(() => a.last("SNAPSHOT").bombermen[0].x >= x0 + 3, 4000);
  a.send({ type: "INPUT", action: "HOLD_DIR", params: { dx: 0, dy: 0 } });

  // 不正入力は無視される
  a.send({ type: "INPUT", action: "MOVE", params: { dx: 99, dy: 0 } });
  b.send({ type: "INPUT", charKeyId: "b0", action: "MOVE", params: { dx: 1, dy: 0 } }); // なりすまし
  await sleep(300);

  // 切断 → NPC代行 → 同じトークンで復帰
  b.ws.close();
  await waitFor(() => a.last("ROSTER_SYNC")?.assignments.m0?.connected === false);
  await waitFor(() => a.last("SNAPSHOT").misobons[0].mode === "npc");
  const c = client("tok_player_cccc"); const d = client("tok_player_dddd"); const e = client("tok_player_eeee");
  await waitFor(() => c.last("INIT") && d.last("INIT") && e.last("INIT"));
  assert.deepEqual([c.last("INIT").assignedCharKey, d.last("INIT").assignedCharKey], ["b1", "m1"], "切断中の m0 を他人に渡さない");
  assert.equal(e.last("INIT").assignedCharKey, null, "枠が満員でも観戦者として入れる(ROOM_FULL にならない)");
  assert.equal(e.last("INIT").spectator, true);
  const b2 = client("tok_player_bbbb");
  await waitFor(() => b2.last("RECONNECT_SUCCESS"));
  assert.equal(b2.last("RECONNECT_SUCCESS").assignedCharKey, "m0");
  await waitFor(() => b2.last("SNAPSHOT")?.misobons[0].mode === "player");

  // 観戦者にも状態が届き、観戦希望(spectate=1)で入ると枠に座らない
  await waitFor(() => e.last("SNAPSHOT"));
  const f = client("tok_player_ffff", { spectate: "1" });
  await waitFor(() => f.last("INIT"));
  assert.equal(f.last("INIT").assignedCharKey, null);

  for (const x of [a, b2, c, d, e, f]) x.ws.close();
});
