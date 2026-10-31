// js/netClient.js
// ネット対戦のクライアント。サーバーが試合の正解を持ち、ここは「入力を送って、状態を映す」だけ。
// サーバーに接続できないとき(静的サーバーだけ・オフライン)は何もせず、ローカルプレイのまま動く。
import { PROTOCOL_VERSION } from "./protocol.js";
import {
  bombermen, misobons, bombs, wallDamage, pillarDamage, bombermanBlocked,
  game, setActiveCharacterKey, recordResult
} from "./state.js";
import { decodeGrid } from "./snapshot.js";
import { renderAll, renderBoard, setLaserGauge, resetLaserGauge } from "./render.js";
import { emitEvent } from "./events.js";
import { uiHooks, btnGameStart, loadingMsgEl, startOverlay, countdownEl, selSdStage } from "./dom.js";
import { clock } from "./clock.js";

const SESSION_STORAGE_KEY = "bombervsmisobon_net_token";
const SPECTATE_STORAGE_KEY = "bombervsmisobon_net_spectate"; // 観戦のまま再接続するための記憶
const MAX_RECONNECT_ATTEMPTS = 8;
const FATAL_CODES = new Set(["VERSION_MISMATCH", "ROOM_NOT_FOUND", "ROOM_FULL", "BAD_TOKEN", "REPLACED", "RATE_LIMIT"]);

const PHASE_LABEL = { lobby: "ロビー", countdown: "開始準備中", playing: "試合中", over: "試合終了" };

function getOrCreateSessionToken() {
  try {
    let tok = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!tok) {
      tok = "tok_" + Date.now().toString(36) + "_" + Math.random().toString(36).substring(2, 9);
      sessionStorage.setItem(SESSION_STORAGE_KEY, tok);
    }
    return tok;
  } catch (e) {
    return "tok_fallback_" + Math.random().toString(36).substring(2, 10);
  }
}

function readWantSpectate() {
  try { return sessionStorage.getItem(SPECTATE_STORAGE_KEY) === "1"; } catch (e) { return false; }
}
function writeWantSpectate(on) {
  try { if (on) sessionStorage.setItem(SPECTATE_STORAGE_KEY, "1"); else sessionStorage.removeItem(SPECTATE_STORAGE_KEY); } catch (e) {}
}

class NetClient {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.roomId = "main";
    this.sessionToken = getOrCreateSessionToken();
    this.playerId = null;
    this.assignedCharKey = null;
    this.accepted = false;      // サーバーに受け入れられたことがあるか
    this.fatal = false;         // 再接続しても無駄なエラーを受けたか
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;

    this.phase = "lobby";
    this.slotConfig = {};
    this.rules = { suddenDeathMaxStage: 2 };
    this.assignments = {};
    this.hostId = null;
    this.playerCount = 0;
    this.spectatorCount = 0;
    this.maxSpectators = 0;
    this.wantSpectate = readWantSpectate(); // 新しく入るとき、枠に座らず観戦者として入りたいか
    this.rttMs = null;

    this.lastProcessedEventId = 0;
    this.processedEventIds = new Set();
    this.seenShotIds = new Set();
    this.seenLaserIds = new Set();
    this.artificialLatencyMs = 0; // フェーズ5-6 人工遅延(送信・受信の両方に足す)
    this.pingTimer = null;
  }

  isHost() {
    return !!this.playerId && this.playerId === this.hostId;
  }

  // 観戦者 = サーバーに受け入れられていて、操作する枠が無い
  isSpectator() {
    return this.accepted && this.assignedCharKey === null;
  }

  // サーバーが決めた枠(null なら観戦)に合わせて、観戦希望の記憶も更新する
  applyAssignment(charKey) {
    this.assignedCharKey = charKey === undefined ? null : charKey;
    setActiveCharacterKey(this.assignedCharKey);
    this.wantSpectate = this.assignedCharKey === null;
    writeWantSpectate(this.wantSpectate);
  }

  init() {
    const params = new URLSearchParams(window.location.search);
    this.roomId = params.get("room") || "main";
    if (params.get("spectate") === "1") { this.wantSpectate = true; writeWantSpectate(true); }
    if (!params.has("room")) {
      try { window.history.replaceState(null, "", `${window.location.pathname}?room=${this.roomId}`); } catch (e) {}
    }
    this.buildInviteUi();
    this.installUiHooks();
    this.updateBanner("ローカルプレイ(サーバーに接続中…)");
    this.connect();
  }

  connect() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host || "localhost:8080";
    const url = `${protocol}//${host}/?room=${encodeURIComponent(this.roomId)}&token=${encodeURIComponent(this.sessionToken)}&v=${encodeURIComponent(PROTOCOL_VERSION)}${this.wantSpectate ? "&spectate=1" : ""}`;

    let ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      this.onClosed();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.connected = true;
      this.reconnectAttempts = 0;
      this.startPing();
    };
    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch (e) { console.error(e); return; }
      if (this.artificialLatencyMs > 0) setTimeout(() => this.handleServerMessage(msg), this.artificialLatencyMs);
      else this.handleServerMessage(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.connected = false;
      this.stopPing();
      this.onClosed();
    };
    ws.onerror = () => { this.connected = false; };
  }

  onClosed() {
    if (!this.accepted) {
      // サーバーが無い/断られた: ローカルプレイのまま遊べる
      if (!this.fatal) this.updateBanner("ローカルプレイ(サーバーに接続できません)");
      return;
    }
    if (this.fatal) return;
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.updateBanner("切断されました。ページを再読み込みしてください(NPCが代行していました)");
      return;
    }
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 8000);
    this.reconnectAttempts += 1;
    this.updateBanner(`切断されました。再接続しています… (${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  startPing() {
    this.stopPing();
    const ping = () => { if (this.isConnected()) this.send({ type: "PING", t: Date.now() }); };
    this.pingTimer = setInterval(ping, 2000);
    ping();
  }

  stopPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  isConnected() {
    return this.connected && !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  send(obj) {
    if (!this.isConnected()) return false;
    const packet = JSON.stringify(obj);
    if (this.artificialLatencyMs > 0) {
      setTimeout(() => { if (this.isConnected()) this.ws.send(packet); }, this.artificialLatencyMs);
    } else {
      this.ws.send(packet);
    }
    return true;
  }

  sendAction(charKeyId, action, params = {}) {
    return this.send({ type: "INPUT", charKeyId, action, params });
  }

  // ---------- 受信 ----------
  handleServerMessage(msg) {
    switch (msg.type) {
      case "ERROR":
        this.onServerError(msg);
        break;
      case "INIT":
      case "RECONNECT_SUCCESS":
        this.accepted = true;
        game.mirror = true; // ここから先、この端末はサーバーの状態を映すだけ
        this.playerId = msg.playerId;
        this.applyAssignment(msg.assignedCharKey);
        this.lastProcessedEventId = msg.latestEventId || 0;
        this.updateBanner();
        break;
      case "ASSIGNED":
        this.applyAssignment(msg.assignedCharKey);
        this.updateBanner();
        this.refreshLobbyUi();
        renderAll();
        break;
      case "ROSTER_SYNC":
        this.phase = msg.phase;
        this.slotConfig = msg.slotConfig || {};
        this.rules = msg.rules || this.rules;
        this.assignments = msg.assignments || {};
        this.hostId = msg.hostId;
        this.playerCount = msg.playerCount || 0;
        this.spectatorCount = msg.spectatorCount || 0;
        this.maxSpectators = msg.maxSpectators || 0;
        this.updateBanner();
        this.refreshLobbyUi();
        renderAll();
        break;
      case "SNAPSHOT":
        if (game.mirror) this.applySnapshot(msg);
        break;
      case "EVENTS":
        if (game.mirror) this.processIncomingEvents(msg.events);
        break;
      case "PONG":
        if (typeof msg.t === "number") { this.rttMs = Date.now() - msg.t; this.updateBanner(); }
        break;
    }
  }

  onServerError(msg) {
    console.warn("[サーバーからのエラー]", msg.code, msg.message);
    if (msg.code === "VERSION_MISMATCH") this.showVersionErrorUi(msg.message);
    else this.showToast(msg.message || msg.code);
    if (msg.fatal || FATAL_CODES.has(msg.code)) {
      this.fatal = true;
      if (!this.accepted) this.updateBanner(`ローカルプレイ(${msg.message || msg.code})`);
      else this.updateBanner(msg.message || msg.code);
    }
  }

  applySnapshot(snap) {
    this.phase = snap.phase || this.phase;
    const now = clock.now();

    game.gameStarted = snap.game.gameStarted;
    game.over = snap.game.over;
    game.suddenDeathStage = snap.game.suddenDeathStage;
    game.misobonRingInset = snap.game.misobonRingInset;

    snap.bombermen.forEach((sb, i) => {
      const b = bombermen[i];
      if (!b) return;
      b.x = sb.x; b.y = sb.y; b.alive = sb.alive; b.mode = sb.mode;
      b.facing = sb.facing || b.facing;
      b.charging = sb.charging; b.immobilized = sb.immobilized; b.bombsActive = sb.bombsActive;
      b.chargeStage = sb.chargeStage || 0;
      b.chargeStartTime = sb.charging ? now - sb.chargeElapsedMs : 0;
    });

    snap.misobons.forEach((sm, i) => {
      const m = misobons[i];
      if (!m) return;
      m.x = sm.x; m.y = sm.y; m.alive = sm.alive; m.mode = sm.mode;
      m.jumpInProgress = sm.jumpInProgress;
      m.jumpState = sm.jump ? { ...sm.jump, startTime: now - sm.jump.elapsedMs } : null;
      m.laserAiming = sm.laserAiming; m.laserCharged = sm.laserCharged; m.laserCooldown = sm.laserCooldown;
      m.aimAxis = sm.aimAxis; m.aimDx = sm.aimDx; m.aimDy = sm.aimDy; m.aimDistance = sm.aimDistance;
      // 途中参加・再接続でも、クールタイムゲージを途中から合わせる(同じ内容の二重通知は無視される)
      if (sm.alive && sm.laserCooldown) setLaserGauge(i, true, sm.laserCooldownRemainingMs || 0, sm.laserCooldownTotalMs || 1);
      else if (sm.alive) setLaserGauge(i, false);
      else resetLaserGauge(i);
    });

    bombs.length = 0;
    snap.bombs.forEach((b) => bombs.push({ id: b.id, x: b.x, y: b.y, ownerKeyId: b.ownerKeyId, explodeAt: now + b.remainingMs }));

    const wd = decodeGrid(snap.wallDamage);
    const pd = decodeGrid(snap.pillarDamage);
    const bl = decodeGrid(snap.blocked);
    for (let y = 0; y < wd.length; y++) {
      for (let x = 0; x < wd[y].length; x++) {
        wallDamage[y][x] = wd[y][x];
        pillarDamage[y][x] = pd[y][x];
        bombermanBlocked[y][x] = bl[y][x] === 1;
      }
    }

    // 途中参加・再接続のとき、まだ見ていない飛行中のショット/レーザーを途中から再生する
    for (const s of snap.chargeShots || []) {
      if (this.seenShotIds.has(s.id)) continue;
      this.seenShotIds.add(s.id);
      emitEvent("CHARGE_SHOT_FIRED", { shotId: s.id, eventId: `snap-s${s.id}`, startX: s.startX, startY: s.startY, endX: s.endX, endY: s.endY, durationMs: s.durationMs, stage: s.stage, elapsedMs: s.elapsedMs });
    }
    for (const l of snap.lasers || []) {
      if (this.seenLaserIds.has(l.id)) continue;
      this.seenLaserIds.add(l.id);
      const axis = l.dx !== 0 ? "horizontal" : "vertical";
      emitEvent("LASER_FIRE", { laserId: l.id, eventId: `snap-l${l.id}`, startX: l.startX, startY: l.startY, dx: l.dx, dy: l.dy, axis, targetDistance: l.distance, isCharged: l.isCharged, durationMs: l.durationMs, elapsedMs: l.elapsedMs });
    }

    renderBoard();
    renderAll();
    this.refreshLobbyUi();
  }

  processIncomingEvents(events) {
    if (!Array.isArray(events)) return;
    for (const ev of events) {
      const eid = ev.eventId;
      if (!eid || eid <= this.lastProcessedEventId || this.processedEventIds.has(eid)) continue;
      this.processedEventIds.add(eid);
      this.lastProcessedEventId = eid;

      if (ev.type === "CHARGE_SHOT_FIRED") {
        if (this.seenShotIds.has(ev.shotId)) continue; // スナップショットで再生済み
        this.seenShotIds.add(ev.shotId);
      } else if (ev.type === "LASER_FIRE") {
        if (ev.laserId !== undefined) {
          if (this.seenLaserIds.has(ev.laserId)) continue;
          this.seenLaserIds.add(ev.laserId);
        }
      } else if (ev.type === "GAME_OVER") {
        // 通常対戦の戦績に記録(サーバーはブラウザの戦績を知らないため、この端末で数える)
        recordResult(ev.matchMode || "normal", ev.winner === "bomberman" || ev.winner === "misobon" ? ev.winner : "draw");
      }
      emitEvent(ev.type, ev);
    }
    if (this.processedEventIds.size > 2000) {
      const threshold = this.lastProcessedEventId - 500;
      for (const id of this.processedEventIds) if (typeof id === "number" && id < threshold) this.processedEventIds.delete(id);
    }
  }

  // ---------- 画面(ロビー・招待・エラー) ----------
  installUiHooks() {
    uiHooks.onSlotModeChange = (char, value) => {
      if (!game.mirror) return false;
      if (!this.isHost()) { this.showToast("枠の設定は部屋の主(最初に入った人)だけができます"); return true; }
      this.send({ type: "SET_SLOT", keyId: char.keyId, mode: value === "player" ? "open" : value });
      return true;
    };
    uiHooks.onCardClick = (char) => {
      if (!game.mirror) return false;
      if (this.assignedCharKey !== char.keyId) this.send({ type: "CHOOSE_SLOT", keyId: char.keyId });
      return true;
    };
    uiHooks.slotSelectValue = (char) => {
      if (!game.mirror) return null;
      const cfg = this.slotConfig[char.keyId];
      return cfg === "open" ? "player" : cfg || null;
    };
    uiHooks.topControls = () => {
      if (!game.mirror) return null;
      const host = this.isHost();
      return {
        abort: host && (this.phase === "countdown" || this.phase === "playing"),
        top: host && this.phase === "over"
      };
    };
    uiHooks.slotSelectDisabled = (char) => game.mirror && (!this.isHost() || (this.phase !== "lobby" && this.phase !== "over"));
  }

  refreshLobbyUi() {
    if (!game.mirror || !btnGameStart) return;
    const lobbyLike = this.phase === "lobby" || this.phase === "over";
    const specBtn = document.getElementById("btn-spectate");
    if (specBtn) specBtn.style.display = lobbyLike && !this.isSpectator() ? "" : "none";
    const specNote = document.getElementById("spectate-note");
    if (specNote) specNote.style.display = lobbyLike && this.isSpectator() ? "" : "none";
    if (selSdStage) {
      selSdStage.value = String(this.rules.suddenDeathMaxStage);
      selSdStage.disabled = !(this.isHost() && lobbyLike);
    }
    if (lobbyLike) {
      startOverlay.classList.remove("hidden");
      btnGameStart.classList.remove("hidden");
      countdownEl.classList.add("hidden");
      btnGameStart.disabled = !this.isHost();
      btnGameStart.textContent = this.isHost() ? "GAME START(全員で開始・BGMあり)" : "部屋の主が開始するのを待っています…";
      if (this.isSpectator() && this.isHost()) btnGameStart.textContent = "GAME START(観戦しながら開始・全員NPCでもOK)";
      loadingMsgEl.classList.add("hidden");
    } else if (this.phase === "playing" && game.gameStarted) {
      startOverlay.classList.add("hidden");
      countdownEl.classList.add("hidden");
    }
  }

  buildInviteUi() {
    let inviteBar = document.getElementById("net-invite-bar");
    if (inviteBar) return;
    inviteBar = document.createElement("div");
    inviteBar.id = "net-invite-bar";
    inviteBar.style.cssText = "display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin-bottom:8px; font-size:12px; color:#ffd700;";
    inviteBar.innerHTML = `
      <span id="room-status-text">部屋: [${this.roomId}]</span>
      <button type="button" id="btn-copy-invite" style="padding:3px 10px; font-size:11px; background:#333; color:#eee; border:1px solid #666; border-radius:4px; cursor:pointer;">招待URLをコピー</button>
      <button type="button" id="btn-copy-spectate" style="padding:3px 10px; font-size:11px; background:#333; color:#eee; border:1px solid #666; border-radius:4px; cursor:pointer;">観戦用URLをコピー</button>
      <button type="button" id="btn-spectate" style="display:none; padding:3px 10px; font-size:11px; background:#333; color:#eee; border:1px solid #666; border-radius:4px; cursor:pointer;">観戦にまわる(枠から降りる)</button>
      <span id="spectate-note" style="display:none; color:#80d8ff; font-size:11px;">観戦中 — 参加したいときは、空いている枠のカードをクリック</span>
      <span id="copy-msg" style="color:#69f0ae; font-size:11px;"></span>
      <label style="margin-left:10px; color:#aaa; font-size:11px;">
        遅延テスト:
        <select id="sel-latency" style="background:#222; color:#eee; border:1px solid #555; border-radius:3px; padding:1px 4px; font-size:11px;">
          <option value="0">なし (0ms)</option>
          <option value="50">50ms</option>
          <option value="100">100ms</option>
          <option value="200">200ms</option>
        </select>
      </label>
      <span id="net-toast" style="color:#ff8a80; font-size:11px;"></span>
    `;
    document.body.insertBefore(inviteBar, document.body.firstChild);

    const copyMsg = document.getElementById("copy-msg");
    document.getElementById("btn-copy-invite").addEventListener("click", () => {
      try {
        navigator.clipboard.writeText(window.location.href).then(() => {
          copyMsg.textContent = "コピー完了! Discord等に貼り付けてください";
          setTimeout(() => { copyMsg.textContent = ""; }, 3000);
        });
      } catch (e) { copyMsg.textContent = "コピーできませんでした。URLを直接コピーしてください"; }
    });
    document.getElementById("btn-copy-spectate").addEventListener("click", () => {
      try {
        const u = new URL(window.location.href);
        u.searchParams.set("spectate", "1");
        navigator.clipboard.writeText(u.toString()).then(() => {
          copyMsg.textContent = "観戦用URLをコピーしました(開いた人は枠に座らず観戦で入ります)";
          setTimeout(() => { copyMsg.textContent = ""; }, 3000);
        });
      } catch (e) { copyMsg.textContent = "コピーできませんでした。URLに &spectate=1 を足してください"; }
    });
    document.getElementById("btn-spectate").addEventListener("click", () => {
      if (!this.isConnected()) return;
      this.send({ type: "SPECTATE" });
    });
    document.getElementById("sel-latency").addEventListener("change", (e) => {
      this.artificialLatencyMs = parseInt(e.target.value, 10) || 0;
    });
  }

  updateBanner(text) {
    const el = document.getElementById("room-status-text");
    if (!el) return;
    if (text !== undefined) { el.textContent = text; return; }
    const host = this.isHost() ? "(部屋の主)" : "";
    const me = this.assignedCharKey ? `操作: ${this.assignedCharKey.toUpperCase()}${host}` : (this.accepted ? `観戦中${host}` : "");
    const rtt = this.rttMs !== null ? ` | 往復 ${this.rttMs}ms` : "";
    const watchers = this.spectatorCount > 0 ? ` | 観戦 ${this.spectatorCount}人` : "";
    el.textContent = `部屋: [${this.roomId}] | ${me} | 参加 ${Math.max(0, this.playerCount - this.spectatorCount)}人${watchers} | ${PHASE_LABEL[this.phase] || this.phase}${rtt}`;
  }

  showToast(text) {
    const el = document.getElementById("net-toast");
    if (!el) return;
    el.textContent = text;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { el.textContent = ""; }, 5000);
  }

  showVersionErrorUi(message) {
    let errBanner = document.getElementById("net-version-error");
    if (errBanner) return;
    errBanner = document.createElement("div");
    errBanner.id = "net-version-error";
    errBanner.style.cssText = "position:fixed; top:12px; left:50%; transform:translateX(-50%); background:#b71c1c; color:#fff; border:2px solid #ff5252; border-radius:8px; padding:12px 20px; font-weight:bold; font-size:13px; z-index:9999; display:flex; gap:14px; align-items:center;";
    const span = document.createElement("span");
    span.textContent = `⚠ ${message}`;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "今すぐ再読み込み";
    btn.style.cssText = "padding:6px 14px; background:#fff; color:#b71c1c; font-weight:bold; border:none; border-radius:4px; cursor:pointer;";
    btn.addEventListener("click", () => window.location.reload());
    errBanner.append(span, btn);
    document.body.appendChild(errBanner);
  }
}

export const netClient = new NetClient();
