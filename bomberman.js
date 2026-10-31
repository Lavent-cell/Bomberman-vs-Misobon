// js/bomberman.js
import { clock } from "./clock.js";
import { bombermen, bombermanBlocked, game, BOMBERMAN_MOVE_INTERVAL_MS } from "./state.js";
import { isFloor } from "./mapData.js";
import { isPillarPassable } from "./misobon.js";
import { checkMatchResult } from "./matchRules.js";
import { placeBomb } from "./bomb.js";
import { cancelBombermanCharge } from "./chargeShot.js";
import { emitEvent } from "./events.js";

export function canMoveBomberman(bm, nx, ny) {
  const isPassable = isFloor(nx, ny) || isPillarPassable(nx, ny);
  if (!isPassable) return false;
  if (bombermanBlocked[ny][nx]) return false;

  const occupied = bombermen.some(
    (other) => other.id !== bm.id && other.alive && other.mode !== "off" && other.x === nx && other.y === ny
  );
  return !occupied;
}

export function killBomberman(bm, message = "ボンバーマンは行動不能になりました") {
  if (!bm.alive) return;
  cancelBombermanCharge(bm);
  bm.alive = false;
  emitEvent("CHAR_KILLED", { charId: bm.id, charKeyId: bm.keyId, name: bm.name, role: "bomberman", reason: message });
  checkMatchResult();
}

export function moveBomberman(bm, dx, dy) {
  if (!game.gameStarted || game.over) return;
  if (!bm.alive || bm.mode === "off") return;
  if (bm.immobilized) return;

  const now = clock.now();
  if (now - bm.lastMoveTime < BOMBERMAN_MOVE_INTERVAL_MS) return;

  const nx = bm.x + dx;
  const ny = bm.y + dy;
  if (canMoveBomberman(bm, nx, ny)) {
    bm.lastMoveTime = now;
    bm.lastActionTime = now;
    bm.stalled = false;
    bm.x = nx;
    bm.y = ny;
    bm.facing.dx = dx;
    bm.facing.dy = dy;
    emitEvent("CHAR_MOVED", { charId: bm.id, charKeyId: bm.keyId, x: nx, y: ny });
  }
}

export function bombermanPlaceBomb(bm) {
  if (!game.gameStarted || game.over) return;
  if (!bm.alive || bm.mode === "off") return;
  placeBomb(bm.x, bm.y, bm);
}
