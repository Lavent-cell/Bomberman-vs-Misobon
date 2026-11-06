// roomCore.js
// 対戦部屋(1部屋のみ)。通信ライブラリに依存しない: conn は { send(str), close(code, reason), readyState } を持てばよい。
// 本番は server.js が ws の接続を渡し、テストは疑似接続を渡す。
import { PROTOCOL_VERSION } from "./js/protocol.js";
import { game, bombermen, misobons } from "./js/state.js";
import { dispatchAction } from "./js/actions.js";
import { stepGame } from "./js/movementLoop.js";
import { drainEvents, addEventListener, removeEventListener, emitEvent, getLatestEventId } from "./js/events.js";
import { resetMatch } from "./js/matchReset.js";
import { startMatchLogic } from "./js/matchStart.js";
import { createSnapshot } from "./js/snapshot.js";
import { clock } from "./js/clock.js";
import { setSuddenDeathMaxStage, SUDDEN_DEATH_STAGE_CHOICES } from "./js/balance.js";

export const SLOT_ORDER = ["b0", "m0", "b1", "m1", "b2", "m2", "m3", "m4"];
const SLOT_MODES = ["open", "npc", "off"];
const OPEN = 1; // WebSocket.OPEN

// open = 人間が入れる枠(空いていればNPC)。npc = 常にNPC。off = 不参加。既定は 2対2
export const DEFAULT_SLOT_CONFIG = { b0: "open", b1: "open", b2: "off", m0: "open", m1: "open", m2: "off", m3: "off", m4: "off" };

const MAX_MESSAGE_CHARS = 1024;
const MAX_MESSAGES_PER_SEC = 150;
export const DEFAULT_MAX_SPECTATORS = 10; // 枠に座らず見るだけの参加者(session.slot === null)の上限

let activeRoom = null;

export function createRoom(options = {}) {
  if (activeRoom) throw new Error("部屋は1つだけです(前の部屋を dispose してください)");
  activeRoom = new GameRoom(options);
  return activeRoom;
}

class GameRoom {
  constructor({ roomCode = "main", countdownSec = 3, reserveMs = 120000, snapshotMs = 50, seed = null, maxSpectators = DEFAULT_MAX_SPECTATORS, hostIdleMs = 600000, log = () => {} } = {}) {
    this.roomCode = roomCode;
    this.countdownSec = countdownSec;
    this.reserveMs = reserveMs;
    this.snapshotMs = snapshotMs;
    this.seed = seed;
    this.maxSpectators = maxSpectators;
    this.hostIdleMs = hostIdleMs;
    this.hostActivityAt = Date.now();
    this.log = log;

    this.clients = new Map();   // conn -> { token, windowStart, windowCount }
    this.sessions = new Map();  // token -> { playerId, slot, connected, joinedAt, reservedUntil }
    this.slotConfig = { ...DEFAULT_SLOT_CONFIG };
    this.rules = { suddenDeathMaxStage: 2 }; // 部屋の主が試合前に選ぶ
    this.phase = "lobby";       // lobby | countdown | playing | over
    this.hostToken = null;
    this.joinCounter = 0;
    this.timers = [];

    this.onEvent = (ev) => {
      if (ev.type === "GAME_OVER") {
        this.phase = "over";
        this.broadcastRoster();
      }
    };
    addEventListener(this.onEvent);

    this.toLobby();
    this.timers.push(clock.setInterval(() => this.tick(), 16, { keep: true }));
    this.timers.push(clock.setInterval(() => this.sendSnapshots(), this.snapshotMs, { keep: true }));
  }

  dispose() {
    this.timers.forEach((id) => clock.clearInterval(id));
    this.timers = [];
    removeEventListener(this.onEvent);
    for (const conn of [...this.clients.keys()]) {
      try { conn.close(1001, "server stopping"); } catch (e) {}
    }
    this.clients.clear();
    clock.cancelAll();
    if (activeRoom === this) activeRoom = null;
  }

  // ---------- 送信 ----------
  sendTo(conn, obj) {
    if (conn.readyState === OPEN) conn.send(JSON.stringify(obj));
  }

  sendError(conn, code, message, fatal = false) {
    this.sendTo(conn, { type: "ERROR", code, message, fatal });
  }

  broadcast(obj) {
    const str = JSON.stringify(obj);
    for (const conn of this.clients.keys()) {
      if (conn.readyState === OPEN) conn.send(str);
    }
  }

  // ---------- 参加枠 ----------
  slotOwner(keyId) {
    for (const [token, s] of this.sessions) if (s.slot === keyId) return token;
    return null;
  }

  // 観戦者 = 枠を持たない参加者(slot が null)。入力は受け付けず、画面の更新だけ受け取る
  spectatorCount(connectedOnly = false) {
    let n = 0;
    for (const [, s] of this.sessions) if (s.slot === null && (!connectedOnly || s.connected)) n++;
    return n;
  }

  firstFreeSlot() {
    return SLOT_ORDER.find((k) => this.slotConfig[k] === "open" && !this.slotOwner(k)) || null;
  }

  charByKey(keyId) {
    return [...bombermen, ...misobons].find((c) => c.keyId === keyId);
  }

  applyRoster() {
    for (const c of [...bombermen, ...misobons]) {
      const cfg = this.slotConfig[c.keyId];
      if (cfg === "off") { c.mode = "off"; c.heldDir = null; continue; }
      const ownerToken = this.slotOwner(c.keyId);
      const human = ownerToken && this.sessions.get(ownerToken).connected;
      c.mode = human ? "player" : "npc";
      if (!human) c.heldDir = null;
    }
  }

  electHost() {
    const connected = [...this.sessions.entries()].filter(([, s]) => s.connected).sort((a, b) => a[1].joinedAt - b[1].joinedAt);
    this.hostToken = connected.length ? connected[0][0] : null;
    this.hostActivityAt = Date.now();
  }

  rosterMessage() {
    const assignments = {};
    for (const [, s] of this.sessions) if (s.slot) assignments[s.slot] = { playerId: s.playerId, connected: s.connected };
    const host = this.hostToken ? this.sessions.get(this.hostToken) : null;
    return {
      type: "ROSTER_SYNC",
      phase: this.phase,
      slotConfig: { ...this.slotConfig },
      rules: { ...this.rules },
      assignments,
      hostId: host ? host.playerId : null,
      playerCount: [...this.sessions.values()].filter((s) => s.connected).length, // 観戦者も含む接続数
      spectatorCount: this.spectatorCount(true),
      maxSpectators: this.maxSpectators
    };
  }

  broadcastRoster() {
    this.broadcast(this.rosterMessage());
  }

  // ---------- 接続 ----------
  handleConnection(conn, { token, version, room, spectate = false } = {}) {
    if (version !== PROTOCOL_VERSION) {
      this.sendError(conn, "VERSION_MISMATCH",
        `通信バージョンが一致しません (サーバー: v${PROTOCOL_VERSION} / あなた: v${version || "未指定"})。ページを再読み込みしてください。`, true);
      conn.close(1008, "Protocol version mismatch");
      return false;
    }
    if (room !== this.roomCode) {
      this.sendError(conn, "ROOM_NOT_FOUND", `部屋 [${room}] はありません。招待URLを確認してください。`, true);
      conn.close(1008, "Room not found");
      return false;
    }
    if (typeof token !== "string" || token.length < 8 || token.length > 100) {
      this.sendError(conn, "BAD_TOKEN", "接続情報が不正です。ページを再読み込みしてください。", true);
      conn.close(1008, "Bad token");
      return false;
    }

    // 同じトークンの接続が残っていれば置き換える(タブの二重起動・切断の検知遅れ)
    for (const [old, info] of this.clients) {
      if (info.token === token) {
        this.clients.delete(old);
        this.sendError(old, "REPLACED", "別のタブ/端末から同じ参加者として接続されました。", true);
        try { old.close(1000, "replaced"); } catch (e) {}
      }
    }

    this.expireReservations();
    let session = this.sessions.get(token);
    let reconnected = false;
    if (session) {
      session.connected = true;
      session.reservedUntil = null;
      reconnected = true;
    } else {
      // 観戦希望、または空き枠が無いときは、観戦者として入る(上限を超えるときだけ断る)
      const slot = spectate ? null : this.firstFreeSlot();
      if (slot === null && this.spectatorCount() >= this.maxSpectators) {
        this.sendError(conn, "ROOM_FULL", `部屋が満員です(参加枠も観戦席も埋まっています。観戦は${this.maxSpectators}人まで)。`, true);
        conn.close(1008, "Room full");
        return false;
      }
      const n = ++this.joinCounter;
      session = { playerId: "p" + n + "_" + token.slice(-4), slot, connected: true, joinedAt: n, reservedUntil: null };
      this.sessions.set(token, session);
    }

    this.clients.set(conn, { token, windowStart: Date.now(), windowCount: 0 });
    if (!this.hostToken || !this.sessions.get(this.hostToken)?.connected) this.electHost();

    const ch = this.charByKey(session.slot);
    if (ch) ch.heldDir = null;
    this.applyRoster();

    this.sendTo(conn, {
      type: reconnected ? "RECONNECT_SUCCESS" : "INIT",
      protocolVersion: PROTOCOL_VERSION,
      roomId: this.roomCode,
      playerId: session.playerId,
      assignedCharKey: session.slot,
      spectator: session.slot === null,
      latestEventId: getLatestEventId(),
      message: reconnected ? `部屋 [${this.roomCode}] に復帰しました` : `部屋 [${this.roomCode}] に入室しました`
    });
    this.sendTo(conn, createSnapshot({ phase: this.phase }));
    this.broadcastRoster();
    this.log(`${reconnected ? "復帰" : "参加"}: ${session.playerId} -> ${session.slot === null ? "観戦" : session.slot}`);
    return true;
  }

  leave(conn) {
    const info = this.clients.get(conn);
    if (!info) return;
    this.clients.delete(conn);
    const session = this.sessions.get(info.token);
    if (!session) return;
    session.connected = false;

    if (session.slot !== null && (this.phase === "playing" || this.phase === "countdown")) {
      // 試合中は枠を予約したまま、NPCが代行する(再接続すれば返す)。観戦者は枠が無いので予約しない
      session.reservedUntil = Date.now() + this.reserveMs;
    } else {
      this.sessions.delete(info.token);
    }
    const ch = this.charByKey(session.slot);
    if (ch) ch.heldDir = null;
    if (this.hostToken === info.token) this.electHost();
    this.applyRoster();
    this.broadcastRoster();
    this.log(`切断: ${session.playerId} (${session.slot === null ? "観戦" : session.slot})`);
  }

  expireReservations() {
    const now = Date.now();
    let changed = false;
    for (const [token, s] of this.sessions) {
      if (!s.connected && s.reservedUntil && s.reservedUntil <= now) {
        this.sessions.delete(token);
        changed = true;
      }
    }
    if (changed) { this.applyRoster(); this.broadcastRoster(); }
  }

  // ---------- 受信 ----------
  handleMessage(conn, raw) {
    const info = this.clients.get(conn);
    if (!info) return;

    const nowMs = Date.now();
    if (nowMs - info.windowStart >= 1000) { info.windowStart = nowMs; info.windowCount = 0; }
    if (++info.windowCount > MAX_MESSAGES_PER_SEC) {
      this.sendError(conn, "RATE_LIMIT", "送信が多すぎます。", true);
      conn.close(1008, "Rate limit");
      return;
    }

    if (typeof raw !== "string" || raw.length > MAX_MESSAGE_CHARS) {
      this.sendError(conn, "BAD_MESSAGE", "メッセージが大きすぎるか、形式が不正です。");
      return;
    }
    let msg;
    try { msg = JSON.parse(raw); } catch (e) {
      this.sendError(conn, "BAD_MESSAGE", "JSONとして読めませんでした。");
      return;
    }
    if (!msg || typeof msg !== "object" || typeof msg.type !== "string") {
      this.sendError(conn, "BAD_MESSAGE", "type がありません。");
      return;
    }

    const session = this.sessions.get(info.token);
    if (!session) return;
    const isHost = this.hostToken === info.token;
    const lobbyLike = this.phase === "lobby" || this.phase === "over";
    // PING is automatic and does not count as human activity.
    if (isHost && ["INPUT", "SET_SLOT", "SPECTATE", "SET_RULE", "CHOOSE_SLOT", "RETURN_TO_LOBBY", "START"].includes(msg.type)) {
      this.hostActivityAt = Date.now();
    }

    switch (msg.type) {
      case "INPUT": {
        if (this.phase !== "playing") return;
        if (session.slot === null) return; // 観戦者の入力は受け付けない
        if (msg.charKeyId !== undefined && msg.charKeyId !== session.slot) return;
        dispatchAction(session.slot, msg.action, msg.params && typeof msg.params === "object" ? msg.params : {});
        return;
      }
      case "PING":
        this.sendTo(conn, { type: "PONG", t: msg.t });
        return;
      case "SET_SLOT": {
        if (!isHost) return this.sendError(conn, "NOT_HOST", "枠の設定は部屋の主(最初に入った人)だけができます。");
        if (!lobbyLike) return this.sendError(conn, "BAD_PHASE", "試合中は枠を変更できません。");
        if (!SLOT_ORDER.includes(msg.keyId) || !SLOT_MODES.includes(msg.mode)) return this.sendError(conn, "BAD_MESSAGE", "枠の指定が不正です。");
        if (msg.mode !== "open") {
          const ownerToken = this.slotOwner(msg.keyId);
          if (ownerToken) {
            // 人が入っている枠をNPC/OFFにする: その人を別の空き枠(人が入れる設定のもの)へ移す。移せる枠が無ければ断る
            let dest = SLOT_ORDER.find((k) => k !== msg.keyId && k[0] === msg.keyId[0] && this.slotConfig[k] === "open" && !this.slotOwner(k)); // 同じ陣営の空き枠
            if (!dest) {
              // 移動先が無い: 座っているのが部屋の主自身なら、観戦者になる(全員NPCの対戦を見るため)。他の人は勝手に観戦へ動かさない
              if (ownerToken === this.hostToken && this.spectatorCount() < this.maxSpectators) dest = null;
              else return this.sendError(conn, "SLOT_OCCUPIED", "その枠には人が入っていて、同じ陣営に移動先の空き枠もありません。先に同じ陣営の別の枠を「操作」にしてください。");
            }
            this.moveSession(ownerToken, dest);
          }
        }
        this.slotConfig[msg.keyId] = msg.mode;
        this.applyRoster();
        this.broadcastRoster();
        return;
      }
      case "SPECTATE": {
        // 枠から降りて観戦者になる(ロビーのときだけ)。観戦席が満員なら断る
        if (!lobbyLike) return this.sendError(conn, "BAD_PHASE", "試合中は枠を変更できません。");
        if (session.slot === null) return;
        if (this.spectatorCount() >= this.maxSpectators) return this.sendError(conn, "SPECTATOR_FULL", `観戦席が満員です(${this.maxSpectators}人まで)。`);
        this.moveSession(info.token, null);
        this.applyRoster();
        this.broadcastRoster();
        return;
      }
      case "SET_RULE": {
        if (!isHost) return this.sendError(conn, "NOT_HOST", "ルールの設定は部屋の主(最初に入った人)だけができます。");
        if (!lobbyLike) return this.sendError(conn, "BAD_PHASE", "試合中はルールを変更できません。");
        if (!SUDDEN_DEATH_STAGE_CHOICES.includes(msg.suddenDeathMaxStage)) return this.sendError(conn, "BAD_MESSAGE", "サドンデスの停止段階は 2 か 4 です。");
        this.rules.suddenDeathMaxStage = msg.suddenDeathMaxStage;
        this.broadcastRoster();
        return;
      }
      case "CHOOSE_SLOT": {
        if (!lobbyLike) return this.sendError(conn, "BAD_PHASE", "試合中は枠を変更できません。");
        if (!SLOT_ORDER.includes(msg.keyId)) return this.sendError(conn, "BAD_MESSAGE", "枠の指定が不正です。");
        const owner = this.slotOwner(msg.keyId);
        if (owner && owner !== info.token) return this.sendError(conn, "SLOT_OCCUPIED", "その枠は他の人が使っています。");
        if (this.slotConfig[msg.keyId] !== "open") {
          if (!isHost) return this.sendError(conn, "SLOT_CLOSED", "その枠は人が入れない設定です。");
          this.slotConfig[msg.keyId] = "open";
        }
        session.slot = msg.keyId;
        this.applyRoster();
        this.sendTo(conn, { type: "ASSIGNED", assignedCharKey: session.slot });
        this.broadcastRoster();
        return;
      }
      case "RETURN_TO_LOBBY": {
        // 試合の中断・終了後のTOPへ戻る。部屋の主だけ。参加者と枠の設定はそのまま、試合の状態だけ初期化する
        if (!isHost) return this.sendError(conn, "NOT_HOST", "TOPへ戻すのは部屋の主だけができます。");
        if (this.phase === "lobby") return;
        this.returnToLobby();
        return;
      }
      case "START": {
        if (!isHost) return this.sendError(conn, "NOT_HOST", "試合開始は部屋の主だけができます。");
        if (!lobbyLike) return this.sendError(conn, "BAD_PHASE", "すでに試合中です。");
        const hasBm = bombermen.some((b) => this.slotConfig[b.keyId] !== "off");
        const hasMb = misobons.some((m) => this.slotConfig[m.keyId] !== "off");
        if (!hasBm || !hasMb) return this.sendError(conn, "NEED_BOTH_SIDES", "ボンバーマンとみそボンを、それぞれ1枠以上 OFF 以外にしてください。");
        this.startCountdown();
        return;
      }
      default:
        this.sendError(conn, "BAD_MESSAGE", `未対応のメッセージです: ${msg.type.slice(0, 20)}`);
    }
  }

  // 人を別の枠へ移す(その人の接続すべてへ通知)
  moveSession(token, keyId) {
    const s = this.sessions.get(token);
    if (!s) return;
    const prev = this.charByKey(s.slot);
    if (prev) prev.heldDir = null;
    s.slot = keyId; // null = 観戦者
    for (const [conn, info] of this.clients) {
      if (info.token === token) this.sendTo(conn, { type: "ASSIGNED", assignedCharKey: keyId });
    }
  }

  // 試合を中断/終了してロビー(TOP)に戻す。resetMatch() がカウントダウンや試合中のタイマーも止める
  returnToLobby() {
    resetMatch(); // MATCH_RESET イベントが全員の画面を初期化する
    this.phase = "lobby";
    this.applyRoster();
    this.broadcastRoster();
    this.log("TOPへ戻しました");
  }

  // ---------- 試合の進行 ----------
  startCountdown() {
    this.phase = "countdown";
    setSuddenDeathMaxStage(this.rules.suddenDeathMaxStage);
    resetMatch();
    this.applyRoster();
    this.broadcastRoster();

    const begin = () => {
      startMatchLogic({ seed: this.seed ?? Date.now(), matchMode: "normal" });
      this.phase = "playing";
      this.broadcastRoster();
    };

    let n = this.countdownSec;
    if (n <= 0) { begin(); return; }
    emitEvent("NET_COUNTDOWN", { count: n });
    const timer = clock.setInterval(() => {
      n -= 1;
      if (n > 0) { emitEvent("NET_COUNTDOWN", { count: n }); return; }
      clock.clearInterval(timer);
      begin();
    }, 1000);
  }

  toLobby() {
    clock.cancelAll(); // keep 付きの部屋のタイマーは残る
    resetMatch();
    this.phase = "lobby";
    this.sessions.clear();
    this.hostToken = null;
    this.applyRoster();
  }

  tick() {
    stepGame();
    const events = drainEvents();
    if (events.length > 0 && this.clients.size > 0) this.broadcast({ type: "EVENTS", events });

    const now = Date.now();
    if (!this._lastExpire || now - this._lastExpire >= 1000) {
      this._lastExpire = now;
      this.expireReservations();
      // Transfer authority after host inactivity without disconnecting players or resetting a match.
      if (this.hostToken && now - this.hostActivityAt >= this.hostIdleMs) {
        const next = [...this.sessions.entries()]
          .filter(([token, session]) => session.connected && token !== this.hostToken)
          .sort((a, b) => a[1].joinedAt - b[1].joinedAt)[0];
        if (next) {
          this.hostToken = next[0];
          this.hostActivityAt = now;
          this.broadcastRoster();
          this.log(`ホスト権限を自動移譲: ${next[1].playerId}`);
        }
      }
      // 誰もいなくなった試合は片付けて、次の人のためにロビーへ戻す
      if (this.phase !== "lobby" && this.clients.size === 0 && this.sessions.size === 0) this.toLobby();
    }
  }

  sendSnapshots() {
    if (this.clients.size === 0) return;
    this.broadcast(createSnapshot({ phase: this.phase }));
  }
}
