// 部屋のテスト(疑似接続)。ws を使わず、サーバーの中身(参加枠・切断・入力・やり直し)を確かめる
import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRoom } from "../roomCore.js";
import { PROTOCOL_VERSION } from "../js/protocol.js";
import { game, bombermen, misobons } from "../js/state.js";
import { balance, setSuddenDeathMaxStage } from "../js/balance.js";
import { endMatch } from "../js/matchRules.js";
import { FakeConn, sleep, waitFor } from "./helpers.mjs";

let room;
beforeEach(() => { room = createRoom({ roomCode: "main", countdownSec: 0, reserveMs: 400 }); });
afterEach(() => { room.dispose(); setSuddenDeathMaxStage(2); });

let tokenSeq = 0;
const newToken = () => `tok_test_${++tokenSeq}_${Math.random().toString(36).slice(2, 8)}`;

function join(token = newToken(), overrides = {}) {
  const conn = new FakeConn();
  const ok = room.handleConnection(conn, { token, version: PROTOCOL_VERSION, room: "main", ...overrides });
  return { conn, token, ok };
}
const send = (conn, obj) => room.handleMessage(conn, JSON.stringify(obj));
const char = (key) => [...bombermen, ...misobons].find((c) => c.keyId === key);

async function startMatch(host) {
  send(host.conn, { type: "START" });
  await waitFor(() => room.phase === "playing");
}

test("バージョン不一致・部屋違い・不正トークンは、エラーを返して切断する", () => {
  const a = join(newToken(), { version: "0.0.1" });
  assert.equal(a.ok, false);
  assert.deepEqual(a.conn.errors(), ["VERSION_MISMATCH"]);
  assert.ok(a.conn.closed);
  const b = join(newToken(), { room: "other" });
  assert.deepEqual(b.conn.errors(), ["ROOM_NOT_FOUND"]);
  const c = join("x");
  assert.deepEqual(c.conn.errors(), ["BAD_TOKEN"]);
  assert.equal(room.clients.size, 0);
});

test("参加順に枠が割り当たり、最初の人が部屋の主になる", () => {
  const a = join(); const b = join();
  assert.equal(a.conn.last("INIT").assignedCharKey, "b0");
  assert.equal(b.conn.last("INIT").assignedCharKey, "m0");
  assert.equal(char("b0").mode, "player");
  assert.equal(char("m0").mode, "player");
  assert.equal(char("b1").mode, "npc");
  assert.equal(char("b2").mode, "off");
  const r = b.conn.last("ROSTER_SYNC");
  assert.equal(r.hostId, a.conn.last("INIT").playerId);
});

test("枠が満員のとき、b0 に二重割当せず、5人目からは観戦者として入る(観戦席も満員なら ROOM_FULL)", () => {
  const players = [join(), join(), join(), join()];
  assert.deepEqual(players.map((p) => p.conn.last("INIT").assignedCharKey), ["b0", "m0", "b1", "m1"]);
  const fifth = join();
  assert.equal(fifth.ok, true);
  assert.deepEqual(fifth.conn.errors(), []);
  assert.equal(fifth.conn.last("INIT").assignedCharKey, null, "観戦者は枠を持たない");
  assert.equal(fifth.conn.last("INIT").spectator, true);
  assert.equal(new Set(players.map((p) => p.conn.last("INIT").assignedCharKey)).size, 4);
  // 観戦席は10人まで(5人目を含めて)。11人目は断る
  for (let i = 0; i < 9; i++) assert.equal(join().ok, true);
  const over = join();
  assert.equal(over.ok, false);
  assert.deepEqual(over.conn.errors(), ["ROOM_FULL"]);
  assert.equal(room.spectatorCount(), 10);
  assert.equal(fifth.conn.last("ROSTER_SYNC").spectatorCount, 10);
});

test("試合前の切断は枠が空き、試合中の切断は枠が予約されて新規参加者に渡らない", async () => {
  const a = join(); const b = join();
  room.leave(b.conn);
  assert.equal(room.slotOwner("m0"), null, "ロビーでは枠が空く");
  const b2 = join(); // m0 を取り直す
  assert.equal(b2.conn.last("INIT").assignedCharKey, "m0");

  await startMatch(a);
  room.leave(b2.conn);
  assert.equal(char("m0").mode, "npc", "切断された枠はNPCが代行");
  const c = join(); const d = join();
  assert.deepEqual([c.conn.last("INIT").assignedCharKey, d.conn.last("INIT").assignedCharKey], ["b1", "m1"], "m0 は予約中なので渡らない");
  const e = join();
  assert.equal(e.conn.last("INIT").assignedCharKey, null, "試合中に満員なら、観戦者として入れる");

  // 本人は同じトークンで復帰できる
  const back = join(b2.token);
  assert.equal(back.conn.last("RECONNECT_SUCCESS").assignedCharKey, "m0");
  assert.equal(char("m0").mode, "player");
});

test("予約は期限が来ると解放される", async () => {
  const a = join(); const b = join();
  await startMatch(a);
  room.leave(b.conn);
  await sleep(500);
  room.expireReservations();
  assert.equal(room.slotOwner("m0"), null);
  const c = join();
  assert.equal(c.conn.last("INIT").assignedCharKey, "m0");
});

test("同じトークンで二重に接続すると、古い接続が置き換えられる", () => {
  const a = join();
  const a2 = join(a.token);
  assert.deepEqual(a.conn.errors(), ["REPLACED"]);
  assert.ok(a.conn.closed);
  assert.equal(a2.conn.last("RECONNECT_SUCCESS").assignedCharKey, "b0");
  assert.equal(room.clients.size, 1);
});

test("不正な入力値は無視され、キャラは動かない", async () => {
  const a = join(); join();
  await startMatch(a);
  const b0 = char("b0");
  const x0 = b0.x, y0 = b0.y;
  for (const params of [{ dx: 5, dy: 0 }, { dx: 1, dy: 1 }, { dx: "1", dy: 0 }, { dx: 0.5, dy: 0 }, { dx: null, dy: null }, {}, { dx: 1e9, dy: 0 }]) {
    send(a.conn, { type: "INPUT", action: "HOLD_DIR", params });
    send(a.conn, { type: "INPUT", action: "MOVE", params });
  }
  send(a.conn, { type: "INPUT", action: "NO_SUCH_ACTION", params: {} });
  send(a.conn, { type: "INPUT", charKeyId: "m0", action: "MOVE", params: { dx: 1, dy: 0 } }); // 他人のキャラ
  await sleep(300);
  assert.deepEqual([b0.x, b0.y], [x0, y0]);
  assert.equal(b0.heldDir, null);
  send(a.conn, { type: "INPUT", action: "AIM_SET_DIST", params: { distance: 1e9 } });
});

test("押しっぱなし(HOLD_DIR)で、サーバーが移動を繰り返し、離すと止まる", async () => {
  const a = join(); join();
  await startMatch(a);
  const b0 = char("b0");
  const x0 = b0.x;
  send(a.conn, { type: "INPUT", action: "HOLD_DIR", params: { dx: 1, dy: 0 } });
  await waitFor(() => b0.x >= x0 + 3, 3000);
  send(a.conn, { type: "INPUT", action: "HOLD_DIR", params: { dx: 0, dy: 0 } });
  await sleep(50);
  const stopped = b0.x;
  await sleep(400);
  assert.equal(b0.x, stopped);
  // スナップショットでも位置が分かる
  const snap = await waitFor(() => a.conn.last("SNAPSHOT"));
  assert.equal(snap.bombermen[0].x, b0.x);
});

test("スナップショットに、飛行中のショット・レーザー・爆弾の残り時間などが含まれる", async () => {
  const a = join(); join();
  await startMatch(a);
  send(a.conn, { type: "INPUT", action: "CHARGE_START", params: {} });
  await sleep(120);
  let snap = await waitFor(() => a.conn.all("SNAPSHOT").filter((s) => s.bombermen[0].charging).pop());
  assert.ok(snap.bombermen[0].chargeElapsedMs > 0);
  assert.equal(snap.bombermen[0].immobilized, true);

  send(a.conn, { type: "INPUT", action: "CHARGE_RELEASE", params: {} }); // 短押し = 爆弾
  snap = await waitFor(() => a.conn.all("SNAPSHOT").filter((s) => s.bombs.length > 0).pop());
  const bomb = snap.bombs[0];
  assert.ok(bomb.remainingMs > 0 && bomb.remainingMs <= 1500);
  assert.equal(bomb.ownerKeyId, "b0");

  // 必要な項目が揃っている
  for (const k of ["chargeShots", "lasers", "wallDamage", "pillarDamage", "blocked", "phase", "game"]) assert.ok(k in snap, k);
  assert.equal(snap.wallDamage.length, 13);
  assert.equal(snap.wallDamage[0].length, 15);
  assert.ok("matchRemainingMs" in snap.game && "suddenDeathCountdown" in snap.game);
  assert.ok(snap.misobons[0].aimDistance !== undefined && snap.misobons[0].laserCooldown !== undefined);
});

test("チャージショットの飛行中はスナップショットに載る", async () => {
  const a = join(); join();
  await startMatch(a);
  send(a.conn, { type: "INPUT", action: "HOLD_DIR", params: { dx: 0, dy: 1 } });
  await sleep(50);
  send(a.conn, { type: "INPUT", action: "HOLD_DIR", params: { dx: 0, dy: 0 } });
  send(a.conn, { type: "INPUT", action: "CHARGE_START", params: {} });
  await sleep(900); // 段階1以上
  send(a.conn, { type: "INPUT", action: "CHARGE_RELEASE", params: {} });
  const snap = await waitFor(() => a.conn.all("SNAPSHOT").filter((s) => s.chargeShots.length > 0).pop(), 2000);
  const shot = snap.chargeShots[0];
  assert.equal(shot.charKeyId, "b0");
  assert.ok(shot.durationMs > 0 && shot.elapsedMs >= 0);
});

test("枠の設定(SET_SLOT / CHOOSE_SLOT)は部屋の主だけ・試合前だけ", async () => {
  const a = join(); const b = join();
  send(b.conn, { type: "SET_SLOT", keyId: "b2", mode: "open" });
  assert.deepEqual(b.conn.errors(), ["NOT_HOST"]);
  send(a.conn, { type: "SET_SLOT", keyId: "b2", mode: "open" });
  assert.equal(room.slotConfig.b2, "open");
  assert.equal(char("b2").mode, "npc");
  send(a.conn, { type: "SET_SLOT", keyId: "m1", mode: "off" });
  assert.equal(char("m1").mode, "off");
  send(a.conn, { type: "SET_SLOT", keyId: "m0", mode: "npc" }); // 人が入っていて、同じ陣営に移動先の空き枠が無い
  assert.ok(a.conn.errors().includes("SLOT_OCCUPIED"));

  send(b.conn, { type: "CHOOSE_SLOT", keyId: "b1" });
  assert.equal(b.conn.last("ASSIGNED").assignedCharKey, "b1");
  assert.equal(char("m0").mode, "npc");
  assert.equal(char("b1").mode, "player");
  send(b.conn, { type: "CHOOSE_SLOT", keyId: "b0" });
  assert.ok(b.conn.errors().includes("SLOT_OCCUPIED"));

  await startMatch(a);
  send(a.conn, { type: "SET_SLOT", keyId: "b2", mode: "off" });
  assert.ok(a.conn.errors().includes("BAD_PHASE"));
});

test("試合開始は部屋の主だけ。片側が全員OFFなら開始できない", async () => {
  const a = join(); const b = join();
  send(b.conn, { type: "START" });
  assert.deepEqual(b.conn.errors(), ["NOT_HOST"]);
  send(b.conn, { type: "CHOOSE_SLOT", keyId: "b1" }); // みそボン側の人間をボンバーマン側へ
  send(a.conn, { type: "SET_SLOT", keyId: "m1", mode: "off" });
  send(a.conn, { type: "SET_SLOT", keyId: "m0", mode: "off" });
  send(a.conn, { type: "START" });
  assert.ok(a.conn.errors().includes("NEED_BOTH_SIDES"));
  assert.equal(room.phase, "lobby");
});

test("試合が終わったら、部屋の主がやり直せる(状態が初期化される)", async () => {
  const a = join(); const b = join();
  await startMatch(a);
  send(a.conn, { type: "INPUT", action: "HOLD_DIR", params: { dx: 1, dy: 0 } });
  await waitFor(() => char("b0").x > 3, 3000);
  send(a.conn, { type: "START" });
  assert.ok(a.conn.errors().includes("BAD_PHASE"), "試合中のSTARTは断る");

  endMatch("misobon", "wipeout");
  await waitFor(() => room.phase === "over");
  assert.equal(game.over, true);
  send(b.conn, { type: "START" });
  assert.ok(b.conn.errors().includes("NOT_HOST"));
  send(a.conn, { type: "START" });
  await waitFor(() => room.phase === "playing");
  assert.equal(game.over, false);
  assert.equal(game.gameStarted, true);
  assert.deepEqual([char("b0").x, char("b0").y], [3, 3]);
  assert.equal(char("b0").alive, true);
  assert.equal(char("b0").heldDir, null);
  assert.equal(char("b0").mode, "player");
  await sleep(60); // 次のティックでイベントが配信される
  const evs = a.conn.all("EVENTS").flatMap((e) => e.events);
  assert.ok(evs.some((e) => e.type === "GAME_OVER"));
  assert.ok(evs.some((e) => e.type === "MATCH_RESET"));
  assert.ok(evs.some((e) => e.type === "MATCH_START"));
});

test("イベントIDは単調増加で、やり直しをまたいでも重複しない", async () => {
  const a = join(); join();
  await startMatch(a);
  endMatch("bomberman", "wipeout");
  await waitFor(() => room.phase === "over");
  send(a.conn, { type: "START" });
  await waitFor(() => room.phase === "playing");
  await sleep(300);
  const ids = a.conn.all("EVENTS").flatMap((e) => e.events.map((x) => x.eventId));
  assert.ok(ids.length > 5);
  for (let i = 1; i < ids.length; i++) assert.ok(ids[i] > ids[i - 1], `eventId が増えていない: ${ids[i - 1]} -> ${ids[i]}`);
});

test("壊れたメッセージ・巨大なメッセージ・送りすぎは、落とさずに拒否する", () => {
  const a = join();
  room.handleMessage(a.conn, "{not json");
  room.handleMessage(a.conn, JSON.stringify({ foo: 1 }));
  room.handleMessage(a.conn, "x".repeat(5000));
  room.handleMessage(a.conn, JSON.stringify({ type: "NOPE" }));
  assert.equal(a.conn.errors().filter((c) => c === "BAD_MESSAGE").length, 4);
  assert.equal(a.conn.closed, null);
  for (let i = 0; i < 200; i++) room.handleMessage(a.conn, JSON.stringify({ type: "PING", t: i }));
  assert.ok(a.conn.errors().includes("RATE_LIMIT"));
  assert.ok(a.conn.closed);
});

test("全員が去った試合は、予約期限後にロビーへ戻る", async () => {
  const a = join(); join();
  await startMatch(a);
  for (const c of [...room.clients.keys()]) room.leave(c);
  await waitFor(() => room.phase === "lobby", 4000);
  assert.equal(game.gameStarted, false);
  assert.equal(room.sessions.size, 0);
});

test("サドンデスの停止段階(2/4)は部屋の主だけが試合前に選べ、開始時に反映される", async () => {
  const a = join(); const b = join();
  assert.equal(b.conn.last("ROSTER_SYNC").rules.suddenDeathMaxStage, 2, "既定は2段");
  send(b.conn, { type: "SET_RULE", suddenDeathMaxStage: 4 });
  assert.deepEqual(b.conn.errors(), ["NOT_HOST"]);
  for (const bad of [3, 0, "4", null, 99]) send(a.conn, { type: "SET_RULE", suddenDeathMaxStage: bad });
  assert.equal(a.conn.errors().filter((c) => c === "BAD_MESSAGE").length, 5);
  assert.equal(room.rules.suddenDeathMaxStage, 2);

  send(a.conn, { type: "SET_RULE", suddenDeathMaxStage: 4 });
  assert.equal(b.conn.last("ROSTER_SYNC").rules.suddenDeathMaxStage, 4, "全員に通知される");
  await startMatch(a);
  assert.equal(balance.suddenDeathMaxStage, 4);
  send(a.conn, { type: "SET_RULE", suddenDeathMaxStage: 2 });
  assert.ok(a.conn.errors().includes("BAD_PHASE"), "試合中は変更できない");
  assert.equal(balance.suddenDeathMaxStage, 4);

  endMatch("misobon", "wipeout");
  await waitFor(() => room.phase === "over");
  send(a.conn, { type: "SET_RULE", suddenDeathMaxStage: 2 });
  send(a.conn, { type: "START" });
  await waitFor(() => room.phase === "playing");
  assert.equal(balance.suddenDeathMaxStage, 2, "やり直しで選び直せる");
});

test("TOPへ戻す: 試合中でも終了後でも、部屋の主だけが戻せる。参加者と枠は残り、試合の状態は初期化される", async () => {
  const a = join(); const b = join();
  send(b.conn, { type: "RETURN_TO_LOBBY" });
  assert.equal(a.conn.errors().length, 0);
  assert.deepEqual(b.conn.errors(), ["NOT_HOST"]);

  // 試合中に中断
  await startMatch(a);
  send(a.conn, { type: "INPUT", action: "HOLD_DIR", params: { dx: 1, dy: 0 } });
  await waitFor(() => char("b0").x > 3, 3000);
  send(b.conn, { type: "RETURN_TO_LOBBY" });
  assert.equal(room.phase, "playing", "主以外では戻らない");
  send(a.conn, { type: "RETURN_TO_LOBBY" });
  assert.equal(room.phase, "lobby");
  assert.equal(game.gameStarted, false);
  assert.equal(game.over, false);
  assert.deepEqual([char("b0").x, char("b0").y], [3, 3]);
  assert.equal(char("b0").heldDir, null);
  assert.equal(room.sessions.size, 2, "参加者は残る");
  assert.equal(char("b0").mode, "player");
  assert.equal(a.conn.last("ROSTER_SYNC").phase, "lobby");
  await sleep(60);
  assert.ok(a.conn.all("EVENTS").flatMap((e) => e.events).some((e) => e.type === "MATCH_RESET"));

  // ロビーに戻ったあとは、もう一度開始できる(カウントダウンの残りで勝手に始まらない)
  await sleep(100);
  assert.equal(room.phase, "lobby");
  await startMatch(a);

  // ゲームセット後に戻す
  endMatch("misobon", "wipeout");
  await waitFor(() => room.phase === "over");
  send(a.conn, { type: "RETURN_TO_LOBBY" });
  assert.equal(room.phase, "lobby");
  assert.equal(char("b0").alive, true);
  assert.equal(game.over, false);
});

test("TOPへ戻す: カウントダウン中に戻しても、そのあと勝手に試合が始まらない", async () => {
  room.dispose();
  room = createRoom({ roomCode: "main", countdownSec: 2, reserveMs: 400 });
  const a = join(); join();
  send(a.conn, { type: "START" });
  assert.equal(room.phase, "countdown");
  send(a.conn, { type: "RETURN_TO_LOBBY" });
  assert.equal(room.phase, "lobby");
  await sleep(2300);
  assert.equal(room.phase, "lobby");
  assert.equal(game.gameStarted, false);
});

test("試合終了後でも、人が入っている枠をNPC/OFFにできる(その人は別の空き枠へ移る)", async () => {
  const a = join(); join();
  await startMatch(a);
  endMatch("misobon", "wipeout");
  await waitFor(() => room.phase === "over");
  // a は b0 にいる。b0 を OFF にする → a は空き枠 b1 へ移る
  send(a.conn, { type: "SET_SLOT", keyId: "b0", mode: "off" });
  assert.equal(a.conn.errors().length, 0);
  assert.equal(room.slotConfig.b0, "off");
  assert.equal(char("b0").mode, "off");
  assert.equal(a.conn.last("ASSIGNED").assignedCharKey, "b1");
  assert.equal(char("b1").mode, "player");
  // 次は b1 を NPC に → 移動先の空き枠が無いので、座っているのが部屋の主なら観戦者になる
  send(a.conn, { type: "SET_SLOT", keyId: "b1", mode: "npc" });
  assert.equal(a.conn.errors().length, 0);
  assert.equal(room.slotConfig.b1, "npc");
  assert.equal(char("b1").mode, "npc");
  assert.equal(a.conn.last("ASSIGNED").assignedCharKey, null);
  assert.equal(room.sessions.get(a.token).slot, null);
  // 戻して、主が b0 を NPC にしてから開始できる
  send(a.conn, { type: "RETURN_TO_LOBBY" });
  send(a.conn, { type: "SET_SLOT", keyId: "b0", mode: "npc" });
  assert.equal(char("b0").mode, "npc");
  send(a.conn, { type: "START" });
  await waitFor(() => room.phase === "playing");
});

// ---------- 観戦者(枠に座らない参加者) ----------

test("観戦希望(spectate)で入ると、空き枠があっても枠に座らない。最初の入室者でも部屋の主になれる", () => {
  const a = join(newToken(), { spectate: true });
  assert.equal(a.conn.last("INIT").assignedCharKey, null);
  assert.equal(room.slotOwner("b0"), null, "b0 は空いたまま");
  assert.equal(room.hostToken, a.token);
  const b = join();
  assert.equal(b.conn.last("INIT").assignedCharKey, "b0", "次の人は先頭の空き枠に座る");
  assert.equal(b.conn.last("ROSTER_SYNC").spectatorCount, 1);
  assert.equal(b.conn.last("ROSTER_SYNC").playerCount, 2);
});

test("観戦者は、スナップショットとイベントを受け取るが、入力は無視される", async () => {
  const a = join(newToken(), { spectate: true }); const p = join();
  assert.equal(p.conn.last("INIT").assignedCharKey, "b0");
  await startMatch(a);
  const b0 = char("b0");
  const x0 = b0.x, y0 = b0.y;
  send(a.conn, { type: "INPUT", action: "HOLD_DIR", params: { dx: 1, dy: 0 } });
  send(a.conn, { type: "INPUT", charKeyId: "b0", action: "HOLD_DIR", params: { dx: 1, dy: 0 } });
  send(a.conn, { type: "INPUT", charKeyId: null, action: "HOLD_DIR", params: { dx: 1, dy: 0 } });
  await sleep(150);
  assert.equal(b0.heldDir, null, "観戦者が b0 を動かせない");
  assert.deepEqual([b0.x, b0.y], [x0, y0]);
  assert.equal(a.conn.errors().length, 0);
  await waitFor(() => a.conn.last("SNAPSHOT"));
  assert.ok(a.conn.last("SNAPSHOT").bombermen, "観戦者にも状態が配られる");
});

test("全員NPCの対戦: 部屋の主が観戦者でも、全枠をNPCにして開始できる", async () => {
  const a = join(newToken(), { spectate: true });
  for (const k of ["b0", "m0", "b1", "m1"]) send(a.conn, { type: "SET_SLOT", keyId: k, mode: "npc" });
  assert.equal(a.conn.errors().length, 0);
  assert.ok([...bombermen, ...misobons].filter((c) => c.mode !== "off").every((c) => c.mode === "npc"), "人が一人もいない");
  await startMatch(a);
  assert.equal(room.phase, "playing");
  await sleep(300);
  assert.ok(a.conn.all("SNAPSHOT").length > 0);
});

test("試合中に途中から観戦者として入れる。観戦者が切断・再接続しても枠を持たない", async () => {
  const a = join(); join();
  await startMatch(a);
  const w = join(newToken(), { spectate: true });
  assert.equal(w.ok, true);
  assert.equal(w.conn.last("INIT").assignedCharKey, null);
  assert.ok(w.conn.last("SNAPSHOT"), "入った時点の状態が届く");
  room.leave(w.conn);
  assert.equal(room.sessions.has(w.token), false, "観戦者は予約されない");
  const w2 = join(w.token, { spectate: true });
  assert.equal(w2.conn.last("INIT").assignedCharKey, null);
});

test("ロビーで、枠から降りて観戦者になり(SPECTATE)、空き枠のカードで戻れる(CHOOSE_SLOT)", () => {
  const a = join(); const b = join();
  send(b.conn, { type: "SPECTATE" });
  assert.equal(b.conn.last("ASSIGNED").assignedCharKey, null);
  assert.equal(room.slotOwner("m0"), null);
  assert.equal(char("m0").mode, "npc", "降りた枠はNPCになる");
  send(b.conn, { type: "CHOOSE_SLOT", keyId: "m0" });
  assert.equal(b.conn.last("ASSIGNED").assignedCharKey, "m0");
  assert.equal(char("m0").mode, "player");
  void a;
});

test("試合中は SPECTATE できない。観戦席が満員のときも断る。観戦者が部屋の主でも他人の枠は勝手に動かさない", async () => {
  const small = [join(), join()];
  send(small[1].conn, { type: "SPECTATE" });
  for (let i = 0; i < 9; i++) join(newToken(), { spectate: true }); // 観戦席: 1 + 9 = 10 人
  send(small[0].conn, { type: "SPECTATE" });
  assert.deepEqual(small[0].conn.errors(), ["SPECTATOR_FULL"]);
  assert.equal(room.sessions.get(small[0].token).slot, "b0");
  await startMatch(small[0]);
  send(small[0].conn, { type: "SPECTATE" });
  assert.ok(small[0].conn.errors().includes("BAD_PHASE"));
});

test("部屋の主以外の人が座る枠をNPCにしようとして移動先が無いときは、これまでどおり断る(勝手に観戦へ動かさない)", () => {
  const a = join(); const b = join(); join(); join();
  send(a.conn, { type: "SET_SLOT", keyId: "m0", mode: "npc" });
  assert.ok(a.conn.errors().includes("SLOT_OCCUPIED"));
  assert.equal(room.sessions.get(b.token).slot, "m0");
});
