// js/misobonLaser.js
import { clock } from "./clock.js";
import { bombermen, game, bombs } from "./state.js";
import { rows, cols } from "./mapData.js";
import { explodeBlast } from "./bomb.js";
import { registerPillarHit, isPillarPassable, isActivePillar } from "./misobon.js";
import { getActiveChargeShotTiles, forceResolveChargeShot } from "./chargeShot.js";
import { balance } from "./balance.js";
import { emitEvent } from "./events.js";

const LASER_MIN_RANGE = 3;
export const MISOBON_CHARGE_WAIT_MS = 1650;

export const activeMisobonLasers = [];
let nextLaserId = 1;

function currentRingBounds() {
  const inset = game.misobonRingInset;
  return {
    minX: inset,
    maxX: cols - 1 - inset,
    minY: inset,
    maxY: rows - 1 - inset
  };
}

export function getMisobonLaserDirection(mb) {
  const { minX, maxX, minY, maxY } = currentRingBounds();
  const onVerticalWall = mb.x === minX || mb.x === maxX;
  const onHorizontalWall = mb.y === minY || mb.y === maxY;

  if (onVerticalWall && onHorizontalWall) return null;
  if (onVerticalWall) {
    return { axis: "horizontal", dx: mb.x === minX ? 1 : -1, dy: 0 };
  }
  if (onHorizontalWall) {
    return { axis: "vertical", dx: 0, dy: mb.y === minY ? 1 : -1 };
  }
  return null;
}

export function getMisobonMaxRange(axis) {
  const inset = game.misobonRingInset;
  const span = axis === "horizontal" ? cols - 2 * inset : rows - 2 * inset;
  return Math.max(LASER_MIN_RANGE, Math.floor(span / 2));
}

function computeAutoLockDistance(mb) {
  const aliveBms = bombermen.filter((b) => b.alive && b.mode !== "off");
  if (aliveBms.length === 0) return LASER_MIN_RANGE;

  let bestDist = LASER_MIN_RANGE;
  let minDiff = Infinity;

  aliveBms.forEach((bm) => {
    const raw = mb.aimAxis === "horizontal"
      ? (bm.x - mb.x) * mb.aimDx
      : (bm.y - mb.y) * mb.aimDy;
    const rounded = Math.round(raw);
    const perpDiff = mb.aimAxis === "horizontal" ? Math.abs(bm.y - mb.y) : Math.abs(bm.x - mb.x);

    if (perpDiff < minDiff && rounded >= LASER_MIN_RANGE) {
      minDiff = perpDiff;
      bestDist = Math.min(rounded, getMisobonMaxRange(mb.aimAxis));
    }
  });

  return bestDist;
}

export function startMisobonAim(mb) {
  if (!game.gameStarted || game.over) return;
  if (!mb.alive || mb.mode === "off") return;
  if (mb.laserAiming || mb.laserCooldown || mb.jumpInProgress) return;

  const dir = getMisobonLaserDirection(mb);
  if (!dir) return;

  mb.aimAxis = dir.axis;
  mb.aimDx = dir.dx;
  mb.aimDy = dir.dy;
  mb.aimManual = false;
  mb.aimDistance = computeAutoLockDistance(mb);

  mb.laserAiming = true;
  mb.laserCharged = false;
  mb.aimStartTime = clock.now();
  mb.lastActionTime = mb.aimStartTime;
  clock.clearTimeout(mb.aimFireTimer);
  clock.clearTimeout(mb.laserChargeTimer);
  mb.aimFireTimer = null;

  mb.laserChargeTimer = clock.setTimeout(() => {
    if (!mb.laserAiming) return;
    mb.laserCharged = true;
    emitEvent("AIM_CHARGED", { charId: mb.id, charKeyId: mb.keyId });
  }, MISOBON_CHARGE_WAIT_MS);

  emitEvent("AIM_START", { charId: mb.id, charKeyId: mb.keyId, axis: mb.aimAxis, distance: mb.aimDistance });
}

export function tickMisobonAim(mb) {}

export function isAimAxisKey(mb, dx, dy) {
  if (!mb.laserAiming || !mb.aimAxis) return false;
  return mb.aimAxis === "horizontal" ? dx !== 0 : dy !== 0;
}

export function setMisobonAimDistance(mb, distance) {
  if (!mb.laserAiming || !mb.aimAxis) return;
  const maxRange = getMisobonMaxRange(mb.aimAxis);
  mb.aimDistance = Math.min(Math.max(distance, LASER_MIN_RANGE), maxRange);
  emitEvent("AIM_UPDATE", { charId: mb.id, distance: mb.aimDistance });
}

export function adjustAimDistance(mb, dx, dy) {
  if (!mb.laserAiming || !mb.aimAxis) return;
  const pressedSign = mb.aimAxis === "horizontal" ? dx : dy;
  const axisSign = mb.aimAxis === "horizontal" ? mb.aimDx : mb.aimDy;
  const delta = pressedSign === axisSign ? 1 : -1;
  const maxRange = getMisobonMaxRange(mb.aimAxis);

  mb.aimManual = true;
  mb.aimDistance = Math.min(Math.max(mb.aimDistance + delta, LASER_MIN_RANGE), maxRange);
  emitEvent("AIM_UPDATE", { charId: mb.id, distance: mb.aimDistance });
}

export function releaseMisobonAim(mb) {
  if (!mb.laserAiming) return;
  if (mb.aimFireTimer != null) return;

  const elapsed = clock.now() - (mb.aimStartTime || 0);
  const remaining = balance.laserMinAimMs - elapsed;
  if (remaining > 0) {
    mb.aimFireTimer = clock.setTimeout(() => {
      mb.aimFireTimer = null;
      if (game.over || !mb.alive) return;
      fireAimedLaser(mb);
    }, remaining);
    return;
  }
  fireAimedLaser(mb);
}

function fireAimedLaser(mb) {
  if (!mb.laserAiming) return;
  mb.laserAiming = false;
  mb.lastActionTime = clock.now();
  mb.stalled = false;
  clock.clearTimeout(mb.laserChargeTimer);
  mb.laserChargeTimer = null;

  const axis = mb.aimAxis;
  const dx = mb.aimDx;
  const dy = mb.aimDy;
  const distance = mb.aimDistance;
  const isCharged = mb.laserCharged;
  mb.laserCharged = false;
  mb.aimAxis = null;

  fireMisobonLaser(mb, axis, dx, dy, distance, isCharged);
  startCooldown(mb);
}

export function cancelMisobonAim(mb) {
  clock.clearTimeout(mb.aimFireTimer);
  clock.clearTimeout(mb.laserChargeTimer);
  mb.aimFireTimer = null;
  mb.laserChargeTimer = null;
  if (!mb.laserAiming) return;
  mb.laserAiming = false;
  mb.laserCharged = false;
  mb.aimAxis = null;
  emitEvent("AIM_CANCEL", { charId: mb.id, charKeyId: mb.keyId });
}

function startCooldown(mb) {
  mb.laserCooldown = true;
  mb.laserCooldownEndsAt = clock.now() + balance.laserCooldownMs;
  clock.clearTimeout(mb.cooldownTimer);
  // 画面のクールタイムゲージ用の通知(ロジックには影響しない)
  emitEvent("LASER_COOLDOWN", { charId: mb.id, charKeyId: mb.keyId, durationMs: balance.laserCooldownMs });
  mb.cooldownTimer = clock.setTimeout(() => {
    mb.laserCooldown = false;
    mb.laserCooldownEndsAt = 0;
    emitEvent("LASER_READY", { charId: mb.id, charKeyId: mb.keyId });
  }, balance.laserCooldownMs);
}

function fireMisobonLaser(mb, axis, dx, dy, targetDistance, isCharged = false) {
  const startX = mb.x;
  const startY = mb.y;
  const endX = startX + dx * targetDistance;
  const endY = startY + dy * targetDistance;

  const durationMs = targetDistance * balance.laserStepMs;
  const startTime = clock.now();
  let finished = false;

  const laserRecord = { id: nextLaserId++, ownerKeyId: mb.keyId, startX, startY, dx, dy, distance: targetDistance, isCharged, startTime, durationMs };
  activeMisobonLasers.push(laserRecord);

  emitEvent("LASER_FIRE", {
    laserId: laserRecord.id,
    charId: mb.id,
    charKeyId: mb.keyId,
    startX, startY, endX, endY,
    axis, dx, dy, targetDistance, isCharged, durationMs
  });

  const hitPillars = new Set();

  function finish(x, y) {
    if (finished) return;
    finished = true;
    const idx = activeMisobonLasers.indexOf(laserRecord);
    if (idx !== -1) activeMisobonLasers.splice(idx, 1);
    emitEvent("LASER_END", { laserId: laserRecord.id, x, y }); // 画面のビームを、止まった位置で消す
    explodeBlast(x, y, {
      range: balance.laserBlastRange,
      damagesWalls: false,
      visualClass: isCharged ? "charge-blast" : undefined,
      killMessage: "みそボンのレーザーに貫かれた…ボンバーマンは行動不能になりました",
      stage: isCharged ? 2 : null,
      shockwaveSize: isCharged ? (balance.laserBlastRange * 2 + 1) * 32 : null
    });
  }

  function step(now) {
    if (finished) return;
    const t = Math.min((now - startTime) / durationMs, 1);
    const dist = targetDistance * t;
    const cx = startX + dx * dist;
    const cy = startY + dy * dist;

    const roundedX = Math.round(cx);
    const roundedY = Math.round(cy);

    if (isActivePillar(roundedX, roundedY)) {
      if (isCharged) {
        const pKey = `${roundedX},${roundedY}`;
        if (!hitPillars.has(pKey)) {
          hitPillars.add(pKey);
          registerPillarHit(roundedX, roundedY);
        }
      } else {
        if (!isPillarPassable(roundedX, roundedY)) {
          registerPillarHit(roundedX, roundedY);
          finish(roundedX - dx, roundedY - dy);
          return;
        }
      }
    }

    const hitBm = bombermen.find((b) => b.alive && b.mode !== "off" && b.x === roundedX && b.y === roundedY);
    if (hitBm) {
      finish(roundedX, roundedY);
      return;
    }

    const hitBomb = bombs.find((b) => b.x === roundedX && b.y === roundedY);
    if (hitBomb) {
      finish(hitBomb.x, hitBomb.y);
      return;
    }

    const shots = getActiveChargeShotTiles(now);
    for (const cs of shots) {
      const distToShot = Math.hypot(cx - cs.x, cy - cs.y);
      if (distToShot < 0.5) {
        const hitX = Math.round(cs.x);
        const hitY = Math.round(cs.y);
        forceResolveChargeShot(cs.shot, cs.x, cs.y);
        finish(hitX, hitY);
        return;
      }
    }

    if (t >= 1) {
      finish(endX, endY);
      return;
    }

    clock.requestFrame(step);
  }

  clock.requestFrame(step);
}
