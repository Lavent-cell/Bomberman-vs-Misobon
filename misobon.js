// js/misobon.js
import { clock } from "./clock.js";
import { misobons, game, wallDamage, pillarDamage, MISOBON_MOVE_INTERVAL_MS } from "./state.js";
import { isRing, isPillar, rows, cols } from "./mapData.js";
import { checkMatchResult } from "./matchRules.js";
import { balance } from "./balance.js";
import { emitEvent } from "./events.js";

export function isRingCellOpen(nx, ny) {
  if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) return false;
  if (!isRing(nx, ny, game.misobonRingInset)) return false;
  if (wallDamage[ny][nx] === 2) return false;
  return true;
}

export function canMoveMisobon(mb, nx, ny) {
  return isRingCellOpen(nx, ny);
}

export function getMisobonMoveInterval(mb) {
  const onCracked = wallDamage[mb.y][mb.x] === 1;
  return onCracked
    ? Math.round(MISOBON_MOVE_INTERVAL_MS * balance.crackedWallMoveMult)
    : MISOBON_MOVE_INTERVAL_MS;
}

// ひび割れた壁は、みそボンが離れると完全破壊になる。
// ただし同じマスに別のみそボンがまだ立っている間は壊さない
// (壊すと、残ったみそボンが「壊れた壁の上」に立つことになり、以後の爆風で死ななくなる=無敵化していた)
export function handleLeavingCell(x, y, leaver = null) {
  if (wallDamage[y][x] !== 1) return;
  const stillThere = misobons.some((m) => m !== leaver && m.alive && m.mode !== "off" && m.x === x && m.y === y);
  if (stillThere) return;
  wallDamage[y][x] = 2;
  emitEvent("WALL_DAMAGE", { x, y, damage: 2 });
}

export function killMisobon(mb, message = "みそボンの壁が完全に崩壊した!") {
  if (!mb.alive) return;

  mb.alive = false;
  mb.jumpInProgress = false;
  mb.jumpState = null;
  mb.laserAiming = false;
  mb.laserCharged = false;
  mb.aimAxis = null;

  clock.clearTimeout(mb.cooldownTimer);
  clock.clearTimeout(mb.aimFireTimer);
  clock.clearTimeout(mb.laserChargeTimer);
  mb.aimFireTimer = null;
  mb.laserChargeTimer = null;
  mb.laserCooldown = false;
  mb.laserCooldownEndsAt = 0;

  emitEvent("CHAR_KILLED", { charId: mb.id, charKeyId: mb.keyId, name: mb.name, role: "misobon", reason: message });
  checkMatchResult();
}

export function registerWallHit(x, y) {
  if (wallDamage[y][x] === 0) {
    wallDamage[y][x] = 1;
    emitEvent("WALL_DAMAGE", { x, y, damage: 1 });
    return;
  }
  if (wallDamage[y][x] === 1) {
    wallDamage[y][x] = 2;
    emitEvent("WALL_DAMAGE", { x, y, damage: 2 });
  }
  // 完全破壊の壁に立っているみそボンは、そのマスが当たるたびに(同じマスに複数いれば全員)倒れる。
  // 壊れた壁の上に立ったまま生き残る状態(無敵)を残さない
  misobons
    .filter((m) => m.alive && m.mode !== "off" && m.x === x && m.y === y)
    .forEach((victim) => killMisobon(victim, `${victim.name} は壁ごと吹き飛ばされた!`));
}

export function isActivePillar(x, y) {
  return isPillar(x, y, game.misobonRingInset);
}

export function registerPillarHit(x, y) {
  if (!isActivePillar(x, y)) return;
  if (pillarDamage[y][x] === 0) {
    pillarDamage[y][x] = 1;
    emitEvent("PILLAR_DAMAGE", { x, y, damage: 1 });
  } else if (pillarDamage[y][x] === 1) {
    pillarDamage[y][x] = 2;
    emitEvent("PILLAR_DAMAGE", { x, y, damage: 2 });
  }
}

export function isPillarPassable(x, y) {
  return isActivePillar(x, y) && pillarDamage[y][x] === 2;
}

const MISOBON_JUMP_LOCK_MS = 2100;
const MISOBON_JUMP_FLIGHT_MS = 1800;

export function tryMisobonJump(mb, dx, dy) {
  if (!game.gameStarted || game.over) return;
  if (!mb.alive || mb.mode === "off") return;
  if (mb.jumpInProgress || mb.laserAiming) return;

  const midX = mb.x + dx, midY = mb.y + dy;
  const farX = mb.x + dx * 2, farY = mb.y + dy * 2;
  const oldX = mb.x, oldY = mb.y;

  let targetX = null;
  let targetY = null;

  if (isRingCellOpen(farX, farY)) {
    targetX = farX;
    targetY = farY;
  } else if (isRingCellOpen(midX, midY)) {
    targetX = midX;
    targetY = midY;
  } else {
    return;
  }

  handleLeavingCell(oldX, oldY, mb);
  mb.x = targetX;
  mb.y = targetY;

  const now = clock.now();
  mb.lastActionTime = now;
  mb.stalled = false;

  mb.jumpInProgress = true;
  mb.jumpState = { fromX: oldX, fromY: oldY, toX: targetX, toY: targetY, startTime: now, durationMs: MISOBON_JUMP_FLIGHT_MS };
  emitEvent("MISOBON_JUMP", {
    charId: mb.id,
    charKeyId: mb.keyId,
    fromX: oldX,
    fromY: oldY,
    toX: targetX,
    toY: targetY,
    durationMs: MISOBON_JUMP_FLIGHT_MS
  });

  clock.setTimeout(() => {
    mb.jumpInProgress = false;
    mb.jumpState = null;
  }, MISOBON_JUMP_LOCK_MS);
}

export function moveMisobon(mb, dx, dy) {
  if (!game.gameStarted || game.over) return;
  if (!mb.alive || mb.mode === "off") return;
  if (mb.laserAiming || mb.jumpInProgress) return;

  if (game.isSpacePressed && mb.mode === "player") {
    tryMisobonJump(mb, dx, dy);
    return;
  }

  const now = clock.now();
  if (now - mb.lastMoveTime < getMisobonMoveInterval(mb)) return;

  const nx = mb.x + dx;
  const ny = mb.y + dy;
  if (canMoveMisobon(mb, nx, ny)) {
    mb.lastMoveTime = now;
    mb.lastActionTime = now;
    mb.stalled = false;
    const oldX = mb.x, oldY = mb.y;
    mb.x = nx;
    mb.y = ny;
    handleLeavingCell(oldX, oldY, mb);
    emitEvent("CHAR_MOVED", { charId: mb.id, charKeyId: mb.keyId, x: nx, y: ny });
  }
}
