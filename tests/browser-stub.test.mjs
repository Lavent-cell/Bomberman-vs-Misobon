// ブラウザ側(画面・入力・ネット)のコードを、簡易DOMの上で動かして確かめる。
// 実機ブラウザの代わりではないが、「例外が出ない」「状態がDOMに反映される」「送るメッセージが正しい」は確認できる。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---- 簡易DOM ----
class El {
  constructor(id = "") {
    this.id = id; this.className = ""; this.children = []; this.style = { setProperty() {} };
    this.textContent = ""; this.disabled = false; this.value = ""; this.listeners = {}; this.innerHTML = "";
    const self = this;
    this.classList = {
      add: (...c) => { const s = new Set(self.className.split(/\s+/).filter(Boolean)); c.forEach((x) => s.add(x)); self.className = [...s].join(" "); },
      remove: (...c) => { self.className = self.className.split(/\s+/).filter((x) => x && !c.includes(x)).join(" "); },
      contains: (c) => self.className.split(/\s+/).includes(c),
      toggle: (c, force) => { const has = self.classList.contains(c); const want = force === undefined ? !has : !!force; self.classList[want ? "add" : "remove"](c); return want; }
    };
  }
  appendChild(c) { this.children.push(c); return c; }
  append(...cs) { cs.forEach((c) => this.children.push(c)); }
  remove() {}
  querySelector() { return new El(); }
  querySelectorAll() { return []; }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  setAttribute() {}
  blur() {}
  insertBefore(c) { this.children.unshift(c); }
}
const byId = new Map();
for (const m of fs.readFileSync(path.join(ROOT, "index.html"), "utf8").matchAll(/id="([^"]+)"/g)) byId.set(m[1], new El(m[1]));
const winListeners = {};
globalThis.document = {
  getElementById: (id) => byId.get(id) || null,
  createElement: () => new El(),
  body: new El("body"),
  addEventListener() {}
};
globalThis.window = {
  addEventListener: (t, fn) => { (winListeners[t] ||= []).push(fn); },
  location: { protocol: "http:", host: "localhost:1", search: "?room=main", pathname: "/", href: "http://localhost:1/?room=main" },
  history: { replaceState() {} }
};
globalThis.WebSocket = { OPEN: 1 };
const U = (m) => import(path.join(ROOT, "js", m));

const dom = await U("dom.js");
const state = await U("state.js");
const events = await U("events.js");
const render = await U("render.js");
const view = await U("viewEvents.js");
const audio = await U("audio.js");
for (const k of Object.getOwnPropertyNames(Object.getPrototypeOf(audio.audioManager))) {
  if (k.startsWith("play") || k === "stop") audio.audioManager[k] = () => {}; // 音は鳴らさない
}
const net = (await U("netClient.js")).netClient;
const input = await U("input.js");
const gameStart = await U("gameStart.js");
const snapshot = await U("snapshot.js");

dom.buildGrid();
render.renderAll();
view.setupViewEvents();
input.setupInput();
gameStart.setupGameStart();
net.installUiHooks();

const cell = (x, y) => dom.cellEls[y][x];
const fireKey = (type, key, extra = {}) => (winListeners[type] || []).forEach((fn) => fn({ key, repeat: false, preventDefault() {}, ...extra }));

test("盤面が作られ、スロットUIが表示される", () => {
  assert.equal(dom.cellEls.length, 13);
  assert.equal(dom.cellEls[0].length, 15);
  assert.ok(cell(0, 0).classList.contains("wall"));
  assert.ok(cell(1, 1).classList.contains("floor"));
});

test("サーバーのイベント(タイマー・カウントダウン・開始・リセット)が画面に反映される", () => {
  events.emitEvent("MATCH_TIMER", { remainingMs: 150000, limitMs: 150000 });
  assert.equal(dom.matchTimerEl.textContent, "制限時間 残り 2:30");
  events.emitEvent("MATCH_TIMER", { remainingMs: 20000, limitMs: 150000 });
  assert.ok(dom.matchTimerEl.classList.contains("warning"));
  events.emitEvent("NET_COUNTDOWN", { count: 3 });
  assert.equal(dom.countdownEl.textContent, "3");
  assert.ok(!dom.countdownEl.classList.contains("hidden"));
  events.emitEvent("MATCH_START", {});
  assert.equal(dom.countdownEl.textContent, "START!");
  events.emitEvent("MATCH_TIME_UP", {});
  assert.equal(dom.matchTimerEl.textContent, "制限時間 終了");
  events.emitEvent("MATCH_RESET", { limitMs: 150000 });
  assert.equal(dom.matchTimerEl.textContent, "制限時間 2:30");
  assert.ok(!dom.startOverlay.classList.contains("hidden"));
});

test("サドンデスの段階が進むと、埋まったマスが壁として描かれる", () => {
  assert.ok(cell(1, 1).classList.contains("floor"));
  state.game.misobonRingInset = 1;
  for (let y = 0; y < 13; y++) for (let x = 0; x < 15; x++) if (x === 1 || x === 13 || y === 1 || y === 11) if (x >= 1 && x <= 13 && y >= 1 && y <= 11) state.bombermanBlocked[y][x] = true;
  events.emitEvent("SUDDEN_DEATH_STAGE", { stage: 1, inset: 1 });
  assert.ok(cell(1, 1).classList.contains("wall"));
  assert.ok(cell(5, 1).classList.contains("wall"));
  assert.ok(cell(2, 3).classList.contains("floor"));
  state.bombermanBlocked.forEach((r) => r.fill(false));
  state.game.misobonRingInset = 0;
});

test("スナップショットを受け取ると、状態・壁のひび・爆弾・飛行中のショットが反映される", () => {
  state.game.mirror = true;
  state.wallDamage[0][3] = 1; state.wallDamage[0][4] = 2; state.pillarDamage[2][2] = 1;
  state.bombs.push({ id: 77, x: 5, y: 3, owner: state.bombermen[0], explodeAt: 0 });
  state.bombermen[0].x = 7; state.bombermen[0].charging = true; state.bombermen[0].chargeStartTime = 0;
  const snap = JSON.parse(JSON.stringify(snapshot.createSnapshot({ phase: "playing" })));
  snap.game.gameStarted = true;
  snap.chargeShots = [{ id: 5, charKeyId: "b0", stage: 2, startX: 3, startY: 3, endX: 9, endY: 3, elapsedMs: 200, durationMs: 540 }];
  state.wallDamage.forEach((r) => r.fill(0)); state.pillarDamage.forEach((r) => r.fill(0)); state.bombs.length = 0; state.bombermen[0].x = 3; state.bombermen[0].charging = false;
  dom.cellEls.forEach((row) => row.forEach((c) => { c.className = c.className.replace(/cracked|wall-broken|pillar-cracked/g, ""); }));
  const seen = [];
  events.addEventListener((e) => seen.push(e));
  net.applySnapshot(snap);
  assert.equal(state.bombermen[0].x, 7);
  assert.equal(state.bombermen[0].charging, true);
  assert.equal(state.bombs.length, 1);
  assert.equal(state.bombs[0].id, 77);
  assert.ok(cell(3, 0).classList.contains("cracked"));
  assert.ok(cell(4, 0).classList.contains("wall-broken"));
  assert.ok(cell(2, 2).classList.contains("pillar-cracked"));
  const shot = seen.find((e) => e.type === "CHARGE_SHOT_FIRED");
  assert.ok(shot && shot.elapsedMs === 200, "飛行中のショットを途中から再生するイベントが出る");
  net.applySnapshot(snap);
  assert.equal(seen.filter((e) => e.type === "CHARGE_SHOT_FIRED").length, 1, "同じショットを二重に再生しない");
});

test("入力: 押しっぱなしの方向は変わったときだけサーバーに送り、離すと0を送る", () => {
  state.game.mirror = true; state.game.gameStarted = true; state.game.over = false;
  state.setActiveCharacterKey("b0");
  state.bombermen[0].mode = "player"; state.bombermen[0].alive = true;
  const sent = [];
  net.connected = true;
  net.ws = { readyState: 1, send: (s) => sent.push(JSON.parse(s)) };
  net.artificialLatencyMs = 0;
  state.currentDirection.dx = 0; state.currentDirection.dy = 0; state.heldDirectionKeys.length = 0;

  fireKey("keydown", "d");
  fireKey("keydown", "d", { repeat: true });
  fireKey("keydown", "d", { repeat: true });
  assert.deepEqual(sent.map((m) => [m.action, m.params.dx, m.params.dy]), [["HOLD_DIR", 1, 0]], "キーリピートでは再送しない / ローカルのMOVEは送らない");
  fireKey("keydown", "s");
  fireKey("keyup", "s");
  fireKey("keyup", "d");
  const holds = sent.map((m) => `${m.params.dx},${m.params.dy}`);
  assert.deepEqual(holds, ["1,0", "0,1", "1,0", "0,0"]);
  sent.length = 0;

  // 短押しでも、離したことは必ず伝える(手元の charging 表示が遅れていても取りこぼさない)
  state.bombermen[0].charging = false;
  fireKey("keydown", " ");
  fireKey("keyup", " ");
  assert.deepEqual(sent.map((m) => m.action), ["CHARGE_START", "CHARGE_RELEASE"]);
});

test("ミラー端末は、ロジックを自前で進めず、ローカルに入力を渡さない", async () => {
  state.game.mirror = true;
  const { stepGame } = await U("movementLoop.js");
  const b1 = state.bombermen[1];
  const before = [b1.x, b1.y];
  b1.mode = "npc";
  for (let i = 0; i < 100; i++) stepGame();
  assert.deepEqual([b1.x, b1.y], before, "NPCが手元で動いてはいけない");
  net.connected = false; // 切断中でもローカルに流れない
  const sent = [];
  net.ws = { readyState: 3, send: (s) => sent.push(s) };
  state.bombermen[0].heldDir = null;
  fireKey("keydown", "a");
  assert.equal(sent.length, 0);
  assert.equal(state.bombermen[0].heldDir, null);
});

test("枠のUI: ミラー端末では、選択がサーバーへの依頼になる(部屋の主以外は無効)", () => {
  state.game.mirror = true;
  const sent = [];
  net.connected = true;
  net.ws = { readyState: 1, send: (s) => sent.push(JSON.parse(s)) };
  net.playerId = "p1"; net.hostId = "p2"; net.phase = "lobby";
  assert.equal(dom.uiHooks.onSlotModeChange(state.bombermen[2], "player"), true);
  assert.equal(sent.length, 0, "部屋の主でなければ送らない");
  net.hostId = "p1";
  dom.uiHooks.onSlotModeChange(state.bombermen[2], "player");
  dom.uiHooks.onSlotModeChange(state.misobons[3], "off");
  assert.deepEqual(sent.map((m) => [m.type, m.keyId, m.mode]), [["SET_SLOT", "b2", "open"], ["SET_SLOT", "m3", "off"]]);
  net.assignedCharKey = "b0";
  dom.uiHooks.onCardClick(state.bombermen[1]);
  assert.deepEqual([sent.at(-1).type, sent.at(-1).keyId], ["CHOOSE_SLOT", "b1"]);
  net.slotConfig = { b2: "open", m3: "off" };
  assert.equal(dom.uiHooks.slotSelectValue(state.bombermen[2]), "player");
  assert.equal(dom.uiHooks.slotSelectDisabled(state.bombermen[0]), false);
  net.phase = "playing";
  assert.equal(dom.uiHooks.slotSelectDisabled(state.bombermen[0]), true);
});

test("通常のローカルプレイ(ミラーでない)では、入力が従来どおりローカルに渡る", () => {
  state.game.mirror = false; state.game.gameStarted = true; state.game.over = false;
  state.bombermen[0].mode = "player"; state.bombermen[0].alive = true; state.setActiveCharacterKey("b0");
  state.bombermen[0].lastMoveTime = -1e9;
  const x0 = state.bombermen[0].x;
  state.currentDirection.dx = 0; state.currentDirection.dy = 0; state.heldDirectionKeys.length = 0;
  fireKey("keydown", "d");
  assert.equal(state.bombermen[0].x, x0 + 1);
  fireKey("keyup", "d");
});

// ---- チャージ表示・照準・ルール選択 ----
test("ボンバーマンのチャージ表示: 開始 → 段階1(青白) → 段階2(ピンク) → 離すと全部消える", () => {
  const el = dom.bombermanEls[0];
  events.emitEvent("CHARGE_START", { charId: 0, charKeyId: "b0", x: 3, y: 3 });
  assert.ok(el.classList.contains("charging"));
  assert.ok(!el.classList.contains("charge-ready"));
  events.emitEvent("CHARGE_STAGE", { charId: 0, charKeyId: "b0", stage: 1 });
  assert.ok(el.classList.contains("charge-ready") && !el.classList.contains("charge-stage-2"));
  events.emitEvent("CHARGE_STAGE", { charId: 0, charKeyId: "b0", stage: 2 });
  assert.ok(el.classList.contains("charge-stage-2"));
  events.emitEvent("CHARGE_RELEASE", { charId: 0, charKeyId: "b0" });
  for (const c of ["charging", "charge-ready", "charge-stage-2"]) assert.ok(!el.classList.contains(c), c);
});

test("みそボンのチャージ表示: 押し始めで charging、チャージ完了で charging+charge-stage-2(ピンク入り粒子・1段階のみ)、発射/キャンセル/死亡で消える。照準マーカーも出る", () => {
  state.game.mirror = false;
  const mb = state.misobons[0];
  const el = dom.misobonEls[0];
  Object.assign(mb, { alive: true, mode: "npc", x: 0, y: 5, laserAiming: true, laserCharged: false, aimAxis: "horizontal", aimDx: 1, aimDy: 0, aimDistance: 4 });
  const markers = () => dom.field.children.filter((c) => c.className.split(" ").includes("aim-marker"));
  const before = markers().length;

  events.emitEvent("AIM_START", { charId: 0, charKeyId: "m0", axis: "horizontal", distance: 4 });
  assert.ok(el.classList.contains("charging") && !el.classList.contains("charge-stage-2"), "押し始めた瞬間からチャージ演出(1段階目の光)が出る。2段階目はまだ");
  assert.equal(markers().length, before + 1);
  const mk = markers().at(-1);
  assert.equal(mk.style.left, `${(0 + 4) * 32}px`);
  assert.equal(mk.style.top, `${5 * 32}px`);

  mb.aimDistance = 6;
  events.emitEvent("AIM_UPDATE", { charId: 0, distance: 6 });
  assert.equal(mk.style.left, `${6 * 32}px`);

  mb.laserCharged = true;
  events.emitEvent("AIM_CHARGED", { charId: 0, charKeyId: "m0" });
  assert.ok(el.classList.contains("charging") && el.classList.contains("charge-stage-2"));

  mb.laserAiming = false; mb.laserCharged = false;
  events.emitEvent("LASER_FIRE", { charId: 0, charKeyId: "m0", startX: 0, startY: 5, dx: 1, dy: 0, axis: "horizontal", targetDistance: 6, isCharged: true, durationMs: 1000 });
  assert.ok(!el.classList.contains("charging") && !el.classList.contains("charge-stage-2"));
  const laserEl = dom.field.children.at(-1);
  assert.ok(laserEl.className.includes("charge-laser"), "チャージレーザーは専用の見た目");

  // 止まったレーザーは、止まった位置でビームが消える(柱の手前で止まったのに突き抜けて見えない)
  events.emitEvent("LASER_FIRE", { laserId: 901, charId: 0, charKeyId: "m0", startX: 0, startY: 8, dx: 1, dy: 0, axis: "horizontal", targetDistance: 8, isCharged: false, durationMs: 1440 });
  const beamEl = dom.field.children.at(-1);
  let removed = false; beamEl.remove = () => { removed = true; };
  events.emitEvent("LASER_END", { laserId: 901, x: 1, y: 8 });
  assert.ok(removed, "LASER_END でビームが消える");

  mb.laserAiming = true; mb.laserCharged = true;
  events.emitEvent("AIM_CHARGED", { charId: 0 });
  mb.alive = false; mb.laserAiming = false;
  events.emitEvent("CHAR_KILLED", { charId: 0, role: "misobon", reason: "x" });
  assert.ok(!el.classList.contains("charging") && !el.classList.contains("charge-stage-2"));
  mb.alive = true; mb.laserCharged = false;
});

test("チャージ爆発(ボンバーマン2段階目・チャージレーザー共通)は、衝撃波とチャージ爆発の見た目で出る", () => {
  state.game.mirror = false;
  const n = dom.field.children.length;
  events.emitEvent("EXPLOSION", { x: 5, y: 5, range: 2, visualClass: "charge-blast", stage: 2, shockwaveSize: null });
  const added = dom.field.children.slice(n).map((c) => c.className);
  assert.ok(added.some((c) => c.includes("charge-blast")));
  assert.ok(added.some((c) => c.includes("charge-explosion") && c.includes("charge-explosion-stage-2")));
});

test("爆風は、届いたマスすべてに炎が描かれる(中心の1マスだけにならない)", () => {
  state.game.mirror = false;
  const n = dom.field.children.length;
  const cells = [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 7, y: 5 }, { x: 4, y: 5 }, { x: 5, y: 4 }];
  events.emitEvent("EXPLOSION", { x: 5, y: 5, range: 2, visualClass: "", stage: null, shockwaveSize: null, cells });
  const circles = dom.field.children.slice(n).filter((c) => c.className.includes("explosion-circle"));
  assert.equal(circles.length, cells.length, "中心1+各マス1");
  // (7,5)のマス中心 = 7*32+16=240, 5*32+16=176。20pxの円なので left/top は 230 / 166
  assert.ok(circles.some((f) => f.style.left === "230px" && f.style.top === "166px" && f.style.width === "20px"), "(7,5)のマスに円がある");
});

test("ミラー端末: スナップショットから、チャージ段階・みそボンのチャージ・照準マーカーが復元される", () => {
  state.game.mirror = true;
  const snap = JSON.parse(JSON.stringify(snapshot.createSnapshot({ phase: "playing" })));
  snap.game.gameStarted = true;
  snap.bombermen[0].charging = true; snap.bombermen[0].chargeStage = 2; snap.bombermen[0].chargeElapsedMs = 1700;
  snap.misobons[1].laserAiming = true; snap.misobons[1].laserCharged = true;
  snap.misobons[1].aimAxis = "horizontal"; snap.misobons[1].aimDx = 1; snap.misobons[1].aimDy = 0; snap.misobons[1].aimDistance = 5;
  snap.misobons[1].alive = true; snap.misobons[1].mode = "npc"; snap.misobons[1].x = 14 - 14; snap.misobons[1].y = 3;
  net.applySnapshot(snap);
  const b = dom.bombermanEls[0];
  assert.ok(b.classList.contains("charging") && b.classList.contains("charge-ready") && b.classList.contains("charge-stage-2"));
  const m = dom.misobonEls[1];
  assert.ok(m.classList.contains("charging") && m.classList.contains("charge-stage-2"));
  const mk = dom.field.children.filter((c) => c.className.includes("aim-marker"));
  assert.ok(mk.length >= 1);
  // 照準中(押し始め)からチャージ演出は出る。2段階目(ピンク)はチャージ完了後だけ
  snap.misobons[1].laserCharged = false;
  net.applySnapshot(snap);
  assert.ok(m.classList.contains("charging") && !m.classList.contains("charge-stage-2"), "押し始めから光・粒子は出る。2段階目はまだ");
  snap.misobons[1].laserCharged = true;
  net.applySnapshot(snap);

  snap.bombermen[0].charging = false; snap.bombermen[0].chargeStage = 0;
  snap.misobons[1].laserAiming = false; snap.misobons[1].laserCharged = false;
  net.applySnapshot(snap);
  assert.ok(!b.classList.contains("charging") && !b.classList.contains("charge-stage-2"));
  assert.ok(!m.classList.contains("charging"));
  state.game.mirror = false;
});

test("サドンデス停止段階の選択: ローカルは選んだ値が使われて保存され、ネット中は部屋の主だけがサーバーに依頼できる", async () => {
  const { balance } = await U("balance.js");
  const sel = dom.selSdStage;
  assert.equal(balance.suddenDeathMaxStage, 2, "既定は2段");
  const store = {};
  globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };

  state.game.mirror = false;
  sel.value = "4";
  sel.listeners.change.forEach((fn) => fn());
  assert.equal(balance.suddenDeathMaxStage, 4);
  assert.equal(store.bombervsmisobon_sd_stage, "4");
  sel.value = "2";
  sel.listeners.change.forEach((fn) => fn());
  assert.equal(balance.suddenDeathMaxStage, 2);

  // ネット中: ローカルの値は変えず、サーバーに依頼。部屋の主でなければ操作できない表示になる
  state.game.mirror = true;
  const sent = [];
  net.connected = true;
  net.ws = { readyState: 1, send: (s) => sent.push(JSON.parse(s)) };
  net.playerId = "p1"; net.hostId = "p1"; net.phase = "lobby"; net.rules = { suddenDeathMaxStage: 2 };
  sel.value = "4";
  sel.listeners.change.forEach((fn) => fn());
  assert.deepEqual(sent.at(-1), { type: "SET_RULE", suddenDeathMaxStage: 4 });
  assert.equal(balance.suddenDeathMaxStage, 2, "確定はサーバーの通知で行う");
  assert.equal(sel.value, "2", "サーバーの値に戻る");
  assert.equal(sel.disabled, false);

  net.hostId = "p2"; net.rules = { suddenDeathMaxStage: 4 };
  net.refreshLobbyUi();
  assert.equal(sel.value, "4");
  assert.equal(sel.disabled, true, "部屋の主以外は変更できない");
  state.game.mirror = false;
});

// ---- ローカルプレイ(game.mirror=false)で、画面が内部の状態に追いついていること ----
// 実機で「ボンバーマンが動かない・みそボンがほとんど動かない・レーザーが何もない所から飛ぶ」が起きた原因は、
// ローカルでは移動などを画面へ描くイベント処理が抜けていたこと。ネット対戦は別経路(スナップショット)で毎回描くので気づけなかった。
const px = (el, prop) => Math.round(parseFloat(el.style[prop]));
const nextFrames = () => new Promise((r) => setTimeout(r, 60));

test("ローカル: 動いたキャラが、すぐ画面の位置に反映される(ボンバーマン・みそボン)", async () => {
  const { dispatchAction } = await U("actions.js");
  const { clock } = await U("clock.js");
  state.game.mirror = false; state.game.gameStarted = true; state.game.over = false;
  const bm = state.bombermen[0], mb = state.misobons[0];
  const bm0 = { x: bm.x, y: bm.y }, mb0 = { x: mb.x, y: mb.y };
  render.renderAll();
  bm.lastMoveTime = -1e9; mb.lastMoveTime = -1e9;

  dispatchAction(bm.keyId, "MOVE", { dx: 1, dy: 0 });
  assert.equal(bm.x, bm0.x + 1);
  assert.equal(px(dom.bombermanEls[bm.id], "left"), bm.x * 32, "ボンバーマンの画面位置(x)が内部位置と一致する");
  assert.equal(px(dom.bombermanEls[bm.id], "top"), bm.y * 32);

  dispatchAction(mb.keyId, "MOVE", { dx: 0, dy: 1 });
  assert.equal(mb.y, mb0.y + 1);
  assert.equal(px(dom.misobonEls[mb.id], "left"), mb.x * 32, "みそボンの画面位置が内部位置と一致する");
  assert.equal(px(dom.misobonEls[mb.id], "top"), mb.y * 32);

  bm.x = bm0.x; bm.y = bm0.y; mb.x = mb0.x; mb.y = mb0.y;
  render.renderAll();
  state.game.gameStarted = false;
  clock.cancelAll();
});

test("ローカル: 爆弾の設置・死亡・サドンデスでのみそボン移動が、次のフレームまでに画面へ反映される", async () => {
  const { dispatchAction } = await U("actions.js");
  const { clock } = await U("clock.js");
  const { killBomberman } = await U("bomberman.js");
  state.game.mirror = false; state.game.gameStarted = true; state.game.over = false;
  const bm = state.bombermen[1], mb = state.misobons[1];
  const bombAt = (x, y) => dom.field.children.some((c) => c.className === "bomb" && px(c, "left") === x * 32 && px(c, "top") === y * 32);
  assert.equal(bombAt(bm.x, bm.y), false);
  const logicBombsBefore = state.bombs.length;

  dispatchAction(bm.keyId, "PLACE_BOMB");
  assert.equal(state.bombs.length, logicBombsBefore + 1);
  await nextFrames();
  assert.equal(bombAt(bm.x, bm.y), true, "置いた爆弾が画面に出る");

  // サドンデス相当: 内部でみそボンの位置が動いたあと、段階イベントで画面の位置も合う
  const mbOld = { x: mb.x, y: mb.y };
  mb.x = 13; mb.y = 1;
  events.emitEvent("SUDDEN_DEATH_STAGE", { stage: 1, inset: 1 });
  await nextFrames();
  assert.equal(px(dom.misobonEls[mb.id], "left"), 13 * 32);
  assert.equal(px(dom.misobonEls[mb.id], "top"), 1 * 32);
  mb.x = mbOld.x; mb.y = mbOld.y;

  // 死亡表示
  clock.cancelAll();
  state.bombs.length = 0;
  state.bombermen.forEach((b) => (b.bombsActive = 0));
  killBomberman(bm, "test");
  await nextFrames();
  assert.ok(dom.bombermanEls[bm.id].classList.contains("dead"), "死んだボンバーマンが画面で死亡表示になる");

  bm.alive = true; state.game.over = false; state.game.gameStarted = false;
  state.game.suddenDeathStage = 0; state.game.misobonRingInset = 0;
  render.renderAll();
  clock.cancelAll();
});

test("TOPへ / 中断してTOPへ: ローカルは試合中に中断・終了後にTOPへ、ネットは部屋の主だけ(押すとサーバーへ依頼)", () => {
  const g = state.game;
  const abort = dom.btnAbort, top = dom.btnTop;
  const hidden = (el) => el.classList.contains("hidden");
  g.mirror = false; g.gameStarted = false; g.over = false;
  render.renderAll();
  assert.ok(hidden(abort) && hidden(top), "開始前はどちらも出ない");
  g.gameStarted = true; render.renderAll();
  assert.ok(!hidden(abort) && hidden(top), "試合中は「中断してTOPへ」");
  g.over = true; render.renderAll();
  assert.ok(hidden(abort) && !hidden(top), "ゲームセット後は「TOPへ」");

  // ローカルで中断 → 試合が初期状態に戻る(死んだキャラも復活、開始画面が出る)
  g.over = false;
  state.bombermen[0].alive = false;
  abort.listeners.click[0]();
  assert.equal(g.gameStarted, false);
  assert.equal(state.bombermen[0].alive, true);
  assert.ok(!dom.startOverlay.classList.contains("hidden"));
  assert.ok(hidden(abort) && hidden(top));

  // ネット対戦: 部屋の主だけに出る
  g.mirror = true; net.playerId = "p1"; net.hostId = "p1";
  net.phase = "playing"; g.gameStarted = true; g.over = false; render.renderAll();
  assert.ok(!hidden(abort) && hidden(top));
  net.phase = "over"; g.over = true; render.renderAll();
  assert.ok(hidden(abort) && !hidden(top));
  const sent = [];
  const origSend = net.send; net.send = (o) => { sent.push(o); return true; };
  top.listeners.click[0]();
  net.send = origSend;
  assert.deepEqual(sent, [{ type: "RETURN_TO_LOBBY" }], "ネットではサーバーに戻してもらう(ローカルのリセットはしない)");
  assert.equal(g.over, true);
  net.hostId = "p2"; render.renderAll();
  assert.ok(hidden(abort) && hidden(top), "部屋の主以外には出ない");

  g.mirror = false; g.gameStarted = false; g.over = false;
  net.playerId = null; net.hostId = null; net.phase = "lobby";
  render.renderAll();
});

// ---- サドンデス2段階目: 壊れた/ひび割れの柱が外周に飲み込まれたマスの見た目 ----
test("サドンデスで外周に飲み込まれた柱は、損傷の見た目が消えて通常の壁になる(壊れた柱=床色のまま透明に見えない)", () => {
  state.game.mirror = false;
  state.game.misobonRingInset = 0;
  state.pillarDamage[2][4] = 2; // 壊れた柱 (4,2)
  state.pillarDamage[4][2] = 1; // ひび割れの柱 (2,4)
  state.pillarDamage[6][6] = 2; // 飲み込まれない壊れた柱はそのまま
  render.renderBoard();
  assert.ok(cell(4, 2).classList.contains("pillar-broken"), "飲み込まれる前は壊れた柱の表示");
  assert.ok(cell(2, 4).classList.contains("pillar-cracked"));

  // 第2段階(inset=2)の外周: x=2/12 または y=2/10 の範囲
  state.game.misobonRingInset = 2;
  for (let y = 2; y <= 10; y++) for (let x = 2; x <= 12; x++) if (x === 2 || x === 12 || y === 2 || y === 10) state.bombermanBlocked[y][x] = true;
  events.emitEvent("SUDDEN_DEATH_STAGE", { stage: 2, inset: 2 });
  for (const [x, y] of [[4, 2], [2, 4]]) {
    const c = cell(x, y);
    assert.ok(c.classList.contains("wall"), `(${x},${y}) は壁`);
    assert.ok(!c.classList.contains("pillar"), `(${x},${y}) は柱ではなくなる`);
    assert.ok(!c.classList.contains("pillar-broken") && !c.classList.contains("pillar-cracked"), `(${x},${y}) に柱の損傷表示が残らない`);
  }
  assert.ok(cell(6, 6).classList.contains("pillar-broken"), "まだ柱であるマスの損傷表示はそのまま");

  state.bombermanBlocked.forEach((r) => r.fill(false));
  state.pillarDamage.forEach((r) => r.fill(0));
  state.game.misobonRingInset = 0;
  render.renderBoard();
});

// ---- みそボンのレーザー クールタイムゲージ ----
test("クールタイムゲージ: 撃つと溜まり始め(laser-cooling)、溜まりきると解除されてフラッシュ。死亡・リセットでフラッシュなしに戻る", () => {
  state.game.mirror = false;
  const el = dom.misobonEls[0];
  const cooling = () => el.classList.contains("laser-cooling");
  assert.ok(!cooling(), "最初は待機(撃てる)表示");
  assert.ok(dom.misobonEls.every((e) => e.innerHTML.includes("laser-gauge-fill")), "全みそボンにゲージ要素がある");

  events.emitEvent("LASER_COOLDOWN", { charId: 0, charKeyId: "m0", durationMs: 4500 });
  assert.ok(cooling());
  assert.ok(!el.classList.contains("laser-ready-flash"));
  events.emitEvent("LASER_READY", { charId: 0, charKeyId: "m0" });
  assert.ok(!cooling());
  assert.ok(el.classList.contains("laser-ready-flash"), "撃てるようになった瞬間にフラッシュ");

  // 次のクールタイムでフラッシュは消える
  events.emitEvent("LASER_COOLDOWN", { charId: 0, charKeyId: "m0", durationMs: 4500 });
  assert.ok(cooling() && !el.classList.contains("laser-ready-flash"));
  // 死亡: フラッシュなしで待機表示に戻る
  events.emitEvent("CHAR_KILLED", { charId: 0, role: "misobon", reason: "x" });
  assert.ok(!cooling() && !el.classList.contains("laser-ready-flash"));
  // リセット
  events.emitEvent("LASER_COOLDOWN", { charId: 1, charKeyId: "m1", durationMs: 4500 });
  assert.ok(dom.misobonEls[1].classList.contains("laser-cooling"));
  events.emitEvent("MATCH_RESET", { limitMs: 150000 });
  assert.ok(dom.misobonEls.every((e) => !e.classList.contains("laser-cooling")));
});

test("ミラー端末: スナップショットから、クールタイム途中のゲージが復元される", () => {
  state.game.mirror = true;
  const snap = JSON.parse(JSON.stringify(snapshot.createSnapshot({ phase: "playing" })));
  snap.game.gameStarted = true;
  snap.misobons[2].alive = true; snap.misobons[2].mode = "npc";
  snap.misobons[2].laserCooldown = true; snap.misobons[2].laserCooldownRemainingMs = 1800; snap.misobons[2].laserCooldownTotalMs = 4500;
  net.applySnapshot(snap);
  assert.ok(dom.misobonEls[2].classList.contains("laser-cooling"), "途中参加でもクールタイム中の表示");
  snap.misobons[2].laserCooldown = false; snap.misobons[2].laserCooldownRemainingMs = 0;
  net.applySnapshot(snap);
  assert.ok(!dom.misobonEls[2].classList.contains("laser-cooling"));
  state.game.mirror = false;
});

test("観戦者(枠なし): assignedCharKey が null でも例外が出ず、キー入力はサーバーへ送らない。枠が付けば操作に戻る", () => {
  state.game.mirror = true;
  const sent = [];
  net.connected = true;
  net.ws = { readyState: 1, send: (s) => sent.push(JSON.parse(s)) };
  net.accepted = true;
  net.handleServerMessage({ type: "INIT", playerId: "p1", assignedCharKey: null, spectator: true, latestEventId: 0 });
  assert.equal(net.isSpectator(), true);
  assert.equal(state.activeCharacterKey, null);
  assert.ok(state.getActiveCharacter(), "観戦者でも getActiveCharacter が落ちない");
  net.handleServerMessage({ type: "ROSTER_SYNC", phase: "lobby", slotConfig: {}, rules: { suddenDeathMaxStage: 2 }, assignments: {}, hostId: "p1", playerCount: 3, spectatorCount: 2, maxSpectators: 10 });
  assert.equal(net.spectatorCount, 2);
  sent.length = 0;
  fireKey("keydown", "d");
  fireKey("keyup", "d");
  fireKey("keydown", " ");
  fireKey("keyup", " ");
  assert.equal(sent.length, 0, "観戦者の入力は送らない");
  // 観戦中でも、部屋の主なら枠の設定は依頼できる(全員NPCの対戦を作るため)
  net.phase = "lobby";
  dom.uiHooks.onSlotModeChange(state.bombermen[0], "npc");
  assert.deepEqual(sent.map((m) => [m.type, m.keyId, m.mode]), [["SET_SLOT", "b0", "npc"]]);
  // 空き枠のカードを押すと参加の依頼になる
  dom.uiHooks.onCardClick(state.bombermen[1]);
  assert.deepEqual([sent.at(-1).type, sent.at(-1).keyId], ["CHOOSE_SLOT", "b1"]);
  // サーバーが枠を割り当てたら操作に戻る
  net.handleServerMessage({ type: "ASSIGNED", assignedCharKey: "b1" });
  assert.equal(net.isSpectator(), false);
  assert.equal(state.activeCharacterKey, "b1");
  net.accepted = false;
  net.assignedCharKey = null;
  state.game.mirror = false;
  state.setActiveCharacterKey("b0");
});
