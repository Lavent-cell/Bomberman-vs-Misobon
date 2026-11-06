// js/chargeShot.js
import { clock } from "./clock.js";
import { game, wallDamage, bombermanBlocked } from "./state.js";
import { map, isRing, rows, cols } from "./mapData.js";
import { registerWallHit, isPillarPassable, isActivePillar } from "./misobon.js";
import { placeBomb, explodeBlast } from "./bomb.js";
import { balance } from "./balance.js";
import { emitEvent } from "./events.js";

export const CHARGE_STAGE_1_MS = 800;
export const CHARGE_STAGE_2_MS = 1600;
const STAGE_1_RANGE = 3;
const SHOT_STEP_MS = 90;

export const activeChargeShots = [];
let nextShotId = 1;

// 経過時間からチャージ段階(0/1/2)を返す。閾値の持ち主はここだけ(画面・通信はこの結果を使う)
export function getChargeStage(elapsedMs) {
  if (elapsedMs >= CHARGE_STAGE_2_MS) return 2;
  if (elapsedMs >= CHARGE_STAGE_1_MS) return 1;
  return 0;
}

function clearChargeStageTimers(bm) {
  if (bm.chargeStageTimers) bm.chargeStageTimers.forEach((id) => clock.clearTimeout(id));
  bm.chargeStageTimers = null;
}

export function registerChargeDirectionInput(bm, dx, dy) {
  if (!bm.charging) return;
  bm.chargeDirection = { dx, dy };
}

export function startBombermanCharge(bm) {
  if (!game.gameStarted || game.over) return;
  if (!bm.alive || bm.mode === "off") return;
  if (bm.charging || bm.immobilized) return;

  bm.charging = true;
  bm.immobilized = true;
  bm.chargeStartTime = clock.now();
  bm.lastActionTime = bm.chargeStartTime;
  bm.chargeDirection = null;

  emitEvent("CHARGE_START", { charId: bm.id, charKeyId: bm.keyId, x: bm.x, y: bm.y });

  // 段階が上がった瞬間をイベントで知らせる(見た目用。ルールには影響しない)
  clearChargeStageTimers(bm);
  bm.chargeStageTimers = [
    clock.setTimeout(() => { if (bm.charging) emitEvent("CHARGE_STAGE", { charId: bm.id, charKeyId: bm.keyId, stage: 1 }); }, CHARGE_STAGE_1_MS),
    clock.setTimeout(() => { if (bm.charging) emitEvent("CHARGE_STAGE", { charId: bm.id, charKeyId: bm.keyId, stage: 2 }); }, CHARGE_STAGE_2_MS)
  ];
}

export function releaseBombermanCharge(bm) {
  if (!bm.charging) return;

  const elapsed = clock.now() - bm.chargeStartTime;
  bm.charging = false;
  clearChargeStageTimers(bm);
  bm.lastActionTime = clock.now();
  bm.stalled = false;

  emitEvent("CHARGE_RELEASE", { charId: bm.id, charKeyId: bm.keyId });

  if (elapsed < CHARGE_STAGE_1_MS) {
    bm.immobilized = false;
    if (bm.alive) placeBomb(bm.x, bm.y, bm);
    return;
  }

  const stage = elapsed >= CHARGE_STAGE_2_MS ? 2 : 1;
  const dir = bm.chargeDirection || bm.facing;
  fireChargeShot(bm, dir.dx, dir.dy, stage);
}

export function cancelBombermanCharge(bm) {
  if (!bm.charging) return;
  bm.charging = false;
  bm.immobilized = false;
  clearChargeStageTimers(bm);
  emitEvent("CHARGE_CANCEL", { charId: bm.id, charKeyId: bm.keyId });
}

// bm は { x, y } を持てばよい(NPCが「そこから撃ったらどうなるか」を調べるのにも使う。状態は変えない)
export function computeShotOutcome(bm, dx, dy, stage) {
  const maxSteps = stage === 1 ? STAGE_1_RANGE : Math.max(rows, cols);
  const ring = game.misobonRingInset;
  let trigger = null;

  for (let step = 1; step <= maxSteps; step++) {
    const nx = bm.x + dx * step;
    const ny = bm.y + dy * step;

    if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) {
      return { travelSteps: step - 1, hitWall: null, trigger };
    }

    if (isActivePillar(nx, ny)) {
      if (isPillarPassable(nx, ny)) continue;
      return { travelSteps: step - 1, hitWall: { x: nx, y: ny, kind: "pillar" }, trigger };
    }

    const isMapWall = map[ny][nx] === "0";
    const isSuddenDeathWall = bombermanBlocked[ny][nx];
    if (!isMapWall && !isSuddenDeathWall) continue;

    const onRing = isRing(nx, ny, ring);
    if (onRing && wallDamage[ny][nx] === 2) {
      if (stage === 2 && !trigger) trigger = { x: nx, y: ny, step };
      continue;
    }

    if (onRing) {
      const damage = wallDamage[ny][nx];
      if (damage === 1 && stage === 2) {
        if (!trigger) trigger = { x: nx, y: ny, step };
        return { travelSteps: step, hitWall: { x: nx, y: ny, kind: "cracked" }, trigger };
      }
      return { travelSteps: step - 1, hitWall: { x: nx, y: ny, kind: damage === 0 ? "normal" : "cracked" }, trigger };
    }

    return { travelSteps: step - 1, hitWall: { x: nx, y: ny, kind: "plain" }, trigger };
  }

  return { travelSteps: maxSteps, hitWall: null, trigger };
}

export function getChargeSpreadCells(trigger) {
  if (!trigger) return [];
  const ring = game.misobonRingInset;
  const cells = [];
  [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
    for (let dist = 1; dist <= balance.chargeStage2SpreadRange; dist++) {
      const x = trigger.x + dx * dist;
      const y = trigger.y + dy * dist;
      if (x < 0 || x >= cols || y < 0 || y >= rows) break;
      if (!isRing(x, y, ring)) continue;
      if (wallDamage[y][x] === 2) continue;
      cells.push({ x, y });
    }
  });
  return cells;
}

function applyChargeSpread(shot) {
  if (!shot.trigger || shot.triggerApplied) return;
  shot.triggerApplied = true;
  clock.clearTimeout(shot.triggerTimer);
  shot.triggerTimer = null;
  if (game.over) return;
  getChargeSpreadCells(shot.trigger).forEach(({ x, y }) => registerWallHit(x, y));
}

function fireChargeShot(bm, dx, dy, stage) {
  const { travelSteps, hitWall, trigger } = computeShotOutcome(bm, dx, dy, stage);
  const startX = bm.x;
  const startY = bm.y;
  const endX = startX + dx * travelSteps;
  const endY = startY + dy * travelSteps;

  const durationMs = Math.max(travelSteps, 1) * SHOT_STEP_MS;
  const startTime = clock.now();

  const shot = {
    id: nextShotId++,
    bm,
    startX, startY, endX, endY, startTime, durationMs,
    stage, hitWall, resolved: false,
    trigger, triggerApplied: false, triggerTimer: null
  };
  activeChargeShots.push(shot);

  emitEvent("CHARGE_SHOT_FIRED", {
    shotId: shot.id,
    charId: bm.id,
    startX, startY, endX, endY,
    durationMs, stage
  });

  if (trigger && trigger.step < travelSteps) {
    shot.triggerTimer = clock.setTimeout(() => applyChargeSpread(shot), trigger.step * SHOT_STEP_MS);
  }

  clock.setTimeout(() => {
    finalizeChargeShot(shot);
  }, durationMs);
}

function finalizeChargeShot(shot) {
  if (shot.resolved) return;
  shot.resolved = true;
  const idx = activeChargeShots.indexOf(shot);
  if (idx !== -1) activeChargeShots.splice(idx, 1);

  resolveChargeShotImpact(shot.endX, shot.endY, shot.hitWall, shot.stage);
  applyChargeSpread(shot);
  shot.bm.immobilized = false;
}

export function getActiveChargeShotTiles(now = clock.now()) {
  return activeChargeShots.map((shot) => {
    const t = Math.min((now - shot.startTime) / shot.durationMs, 1);
    return {
      shot,
      x: shot.startX + (shot.endX - shot.startX) * t,
      y: shot.startY + (shot.endY - shot.startY) * t
    };
  });
}

export function forceResolveChargeShot(shot, fx, fy) {
  if (!shot || shot.resolved) return;
  shot.resolved = true;
  clock.clearTimeout(shot.triggerTimer);
  shot.triggerTimer = null;
  const idx = activeChargeShots.indexOf(shot);
  if (idx !== -1) activeChargeShots.splice(idx, 1);

  resolveChargeShotImpact(Math.round(fx), Math.round(fy), null, shot.stage);
  shot.bm.immobilized = false;
}

function resolveChargeShotImpact(x, y, hitWall, stage) {
  if (hitWall) {
    if (hitWall.kind !== "pillar" && x === hitWall.x && y === hitWall.y) {
      registerWallHit(hitWall.x, hitWall.y);
    }
  }

  explodeBlast(x, y, {
    visualClass: "charge-blast",
    killMessage: "チャージショットの爆風に巻き込まれた…ボンバーマンは行動不能になりました",
    stage
  });
}
