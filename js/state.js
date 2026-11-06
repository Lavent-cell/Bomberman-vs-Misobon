// js/state.js
import { rows, cols } from "./mapData.js";

export const BOMBERMAN_MAX = 3;
export const MISOBON_MAX = 5;

export const BOMBERMAN_COLORS = [
  { id: 0, label: "B1", name: "白ボン", color: "#f8f9fa", accent: "#00e5ff", visor: "#263238", text: "#111" },
  { id: 1, label: "B2", name: "青ボン", color: "#1976d2", accent: "#ffd600", visor: "#ffffff", text: "#fff" },
  { id: 2, label: "B3", name: "緑ボン", color: "#388e3c", accent: "#76ff03", visor: "#ffffff", text: "#fff" }
];

export const MISOBON_COLORS = [
  { id: 0, label: "M1", name: "赤みそ", color: "#d50000", horn: "#ff8a80", eye: "#ffebee", text: "#fff" },
  { id: 1, label: "M2", name: "紫みそ", color: "#7b1fa2", horn: "#b388ff", eye: "#f3e5f5", text: "#fff" },
  { id: 2, label: "M3", name: "橙みそ", color: "#e65100", horn: "#ffab40", eye: "#fff3e0", text: "#fff" },
  { id: 3, label: "M4", name: "桃みそ", color: "#c2185b", horn: "#ff4081", eye: "#fce4ec", text: "#fff" },
  { id: 4, label: "M5", name: "黒みそ", color: "#263238", horn: "#78909c", eye: "#00e5ff", text: "#fff" }
];

const BM_SPAWNS = [
  { x: 3, y: 3 },
  { x: 11, y: 9 },
  { x: 11, y: 3 }
];

const MB_SPAWNS = [
  { x: 0, y: 5 },
  { x: 14, y: 5 },
  { x: 5, y: 0 },
  { x: 9, y: 12 },
  { x: 0, y: 8 }
];

const ROSTER_STORAGE_KEY = "bombervsmisobon_roster";
const VALID_MODES = ["player", "npc", "off"];

function sanitizeMode(mode, fallback) {
  return VALID_MODES.includes(mode) ? mode : fallback;
}

function loadRosterSettings() {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(ROSTER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.bombermen) || !Array.isArray(parsed.misobons)) return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

const savedRoster = loadRosterSettings();

export const bombermen = BOMBERMAN_COLORS.map((c, i) => {
  const defaultMode = i === 0 ? "player" : i === 1 ? "npc" : "off";
  const savedMode = savedRoster ? sanitizeMode(savedRoster.bombermen[i], null) : null;
  return {
    id: i,
    keyId: `b${i}`,
    role: "bomberman",
    name: `ボンバーマン${i + 1} (${c.name})`,
    label: c.label,
    colorInfo: c,
    x: BM_SPAWNS[i].x,
    y: BM_SPAWNS[i].y,
    alive: true,
    mode: savedMode || defaultMode,
    facing: { dx: 0, dy: 1 },
    charging: false,
    chargeStartTime: 0,
    chargeDirection: null,
    immobilized: false,
    bombsActive: 0,
    lastMoveTime: 0,
    lastActionTime: 0,
    stalled: false,
    heldDir: null,
    chargeStageTimers: null
  };
});

export const misobons = MISOBON_COLORS.map((c, i) => {
  const defaultMode = i < 2 ? "npc" : "off";
  const savedMode = savedRoster ? sanitizeMode(savedRoster.misobons[i], null) : null;
  return {
    id: i,
    keyId: `m${i}`,
    role: "misobon",
    name: `みそボン${i + 1} (${c.name})`,
    label: c.label,
    colorInfo: c,
    x: MB_SPAWNS[i].x,
    y: MB_SPAWNS[i].y,
    alive: true,
    mode: savedMode || defaultMode,
    jumpInProgress: false,
    jumpState: null,
    laserAiming: false,
    laserCooldown: false,
    laserCooldownEndsAt: 0,
    laserCharged: false,
    aimAxis: null,
    aimDx: 0,
    aimDy: 0,
    aimDistance: 3,
    aimManual: false,
    aimStartTime: 0,
    aimFireTimer: null,
    cooldownTimer: null,
    lastMoveTime: 0,
    lastActionTime: 0,
    stalled: false,
    heldDir: null
  };
});

export function saveRosterSettings() {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(
      ROSTER_STORAGE_KEY,
      JSON.stringify({
        bombermen: bombermen.map((b) => b.mode),
        misobons: misobons.map((m) => m.mode)
      })
    );
  } catch (e) {}
}

const firstPlayerChar = [...bombermen, ...misobons].find((c) => c.mode === "player");
export let activeCharacterKey = firstPlayerChar ? firstPlayerChar.keyId : "b0";

export function getActiveCharacter() {
  if (!activeCharacterKey) return bombermen[0]; // 観戦者(操作するキャラなし)。入力は送られない
  if (activeCharacterKey.startsWith("b")) {
    return bombermen.find((b) => b.keyId === activeCharacterKey) || bombermen[0];
  }
  return misobons.find((m) => m.keyId === activeCharacterKey) || misobons[0];
}

export function setActiveCharacterKey(keyId) {
  activeCharacterKey = keyId;
}

export const game = {
  misobonRingInset: 0,
  suddenDeathStage: 0,
  gameStarted: false,
  isSpacePressed: false,
  over: false,
  matchMode: "normal",
  silentMode: false,
  // true: サーバーの状態を映すだけの端末(ロジックを自前で進めない)。接続状態で変わる値なので試合リセットでは触らない
  mirror: false
};

export const SCORE_STORAGE_KEYS = {
  normal: "bombervsmisobon_score",
  measure: "bombervsmisobon_score_measure"
};

function emptyScore() {
  return { bomberman: 0, misobon: 0, draw: 0 };
}

function loadScore(bucket) {
  try {
    if (typeof localStorage === "undefined") return emptyScore();
    const raw = localStorage.getItem(SCORE_STORAGE_KEYS[bucket]);
    if (!raw) return emptyScore();
    const parsed = JSON.parse(raw);
    const num = (v) => (Number.isFinite(v) && v >= 0 ? v : 0);
    return { bomberman: num(parsed.bomberman), misobon: num(parsed.misobon), draw: num(parsed.draw) };
  } catch (e) {
    return emptyScore();
  }
}

function saveScore(bucket) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(SCORE_STORAGE_KEYS[bucket], JSON.stringify(scores[bucket]));
  } catch (e) {}
}

export const scores = {
  normal: loadScore("normal"),
  measure: loadScore("measure")
};

export function recordResult(bucket, result) {
  if (!scores[bucket]) return;
  if (result !== "bomberman" && result !== "misobon" && result !== "draw") return;
  scores[bucket][result] += 1;
  saveScore(bucket);
}

export function resetScore(bucket) {
  if (!scores[bucket]) return;
  scores[bucket].bomberman = 0;
  scores[bucket].misobon = 0;
  scores[bucket].draw = 0;
  saveScore(bucket);
}

export const bombermanBlocked = Array.from({ length: rows }, () => Array(cols).fill(false));
export const wallDamage = Array.from({ length: rows }, () => Array(cols).fill(0));
export const pillarDamage = Array.from({ length: rows }, () => Array(cols).fill(0));
export const bombs = [];

const BASE_MOVE_INTERVAL_MS = 150;
export const BOMBERMAN_MOVE_INTERVAL_MS = Math.round(BASE_MOVE_INTERVAL_MS / 0.8);
export const MISOBON_MOVE_INTERVAL_MS = Math.round(BASE_MOVE_INTERVAL_MS / 0.8);

const VOLUME_STORAGE_KEY = "bombervsmisobon_volume";
const DEFAULT_VOLUME_SETTINGS = { master: 80, bgm: 70, sfx: 80 };

function clampVolume(value, fallback) {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.min(100, Math.max(0, value));
}

function loadVolumeSettings() {
  try {
    if (typeof localStorage === "undefined") return { ...DEFAULT_VOLUME_SETTINGS };
    const raw = localStorage.getItem(VOLUME_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_VOLUME_SETTINGS };
    const parsed = JSON.parse(raw);
    return {
      master: clampVolume(parsed.master, DEFAULT_VOLUME_SETTINGS.master),
      bgm: clampVolume(parsed.bgm, DEFAULT_VOLUME_SETTINGS.bgm),
      sfx: clampVolume(parsed.sfx, DEFAULT_VOLUME_SETTINGS.sfx)
    };
  } catch (e) {
    return { ...DEFAULT_VOLUME_SETTINGS };
  }
}

export const volumeSettings = loadVolumeSettings();

export function saveVolumeSettings() {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(VOLUME_STORAGE_KEY, JSON.stringify(volumeSettings));
  } catch (e) {}
}

export const heldDirectionKeys = [];
export const currentDirection = { dx: 0, dy: 0 };

export function pushOrUpdateDirectionKey(key, dir) {
  const idx = heldDirectionKeys.findIndex((k) => k.key === key);
  if (idx !== -1) heldDirectionKeys.splice(idx, 1);
  heldDirectionKeys.push({ key, dir });
  currentDirection.dx = dir.dx;
  currentDirection.dy = dir.dy;
}

export function removeDirectionKey(key) {
  const idx = heldDirectionKeys.findIndex((k) => k.key === key);
  if (idx !== -1) heldDirectionKeys.splice(idx, 1);
  const last = heldDirectionKeys[heldDirectionKeys.length - 1];
  if (last) {
    currentDirection.dx = last.dir.dx;
    currentDirection.dy = last.dir.dy;
  } else {
    currentDirection.dx = 0;
    currentDirection.dy = 0;
  }
}

export function resetMatchState() {
  bombermen.forEach((bm, i) => {
    bm.x = BM_SPAWNS[i].x;
    bm.y = BM_SPAWNS[i].y;
    bm.alive = true;
    bm.facing = { dx: 0, dy: 1 };
    bm.charging = false;
    bm.chargeStartTime = 0;
    bm.chargeDirection = null;
    bm.immobilized = false;
    bm.bombsActive = 0;
    bm.lastMoveTime = 0;
    bm.lastActionTime = 0;
    bm.stalled = false;
    bm.heldDir = null;
    bm.chargeStageTimers = null;
  });

  misobons.forEach((mb, i) => {
    mb.x = MB_SPAWNS[i].x;
    mb.y = MB_SPAWNS[i].y;
    mb.alive = true;
    mb.jumpInProgress = false;
    mb.jumpState = null;
    mb.laserAiming = false;
    mb.laserCooldown = false;
    mb.laserCooldownEndsAt = 0;
    mb.laserCharged = false;
    mb.aimAxis = null;
    mb.aimDx = 0;
    mb.aimDy = 0;
    mb.aimDistance = 3;
    mb.aimManual = false;
    mb.aimStartTime = 0;
    mb.aimFireTimer = null;
    mb.cooldownTimer = null;
    mb.lastMoveTime = 0;
    mb.lastActionTime = 0;
    mb.stalled = false;
    mb.heldDir = null;
  });

  game.misobonRingInset = 0;
  game.suddenDeathStage = 0;
  game.gameStarted = false;
  game.isSpacePressed = false;
  game.over = false;
  game.matchMode = "normal";
  game.silentMode = false;

  for (let y = 0; y < rows; y++) {
    bombermanBlocked[y].fill(false);
    wallDamage[y].fill(0);
    pillarDamage[y].fill(0);
  }
  bombs.length = 0;

  heldDirectionKeys.length = 0;
  currentDirection.dx = 0;
  currentDirection.dy = 0;
}
