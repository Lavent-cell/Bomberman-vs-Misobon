// js/ai.js
import { clock } from "./clock.js";
import {
  bombermen, misobons, bombs, bombermanBlocked, wallDamage, game, BOMBERMAN_MOVE_INTERVAL_MS
} from "./state.js";
import { map, rows, cols, isFloor, isRing } from "./mapData.js";
import { canMoveBomberman } from "./bomberman.js";
import { canMoveMisobon, getMisobonMoveInterval, isPillarPassable, isActivePillar, isRingCellOpen } from "./misobon.js";
import { balance } from "./balance.js";
import { activeChargeShots, getChargeSpreadCells, computeShotOutcome } from "./chargeShot.js";
import { getMisobonLaserDirection, getMisobonMaxRange, activeMisobonLasers, MISOBON_CHARGE_WAIT_MS } from "./misobonLaser.js";
import { random, shuffled } from "./random.js";
import { dispatchAction } from "./actions.js";

const DIRS = [
  { dx: 0, dy: -1 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
  { dx: 1, dy: 0 }
];

const BOMB_ESCAPE_MAX_STEPS = 4;
const NPC_AIM_HOLD_MS = 500;
const CHARGE_STAGE_1_WAIT_MS = 850;
const CHARGE_STAGE_2_WAIT_MS = 1650;
const CHARGE_MIN_CLEAR_STEPS = 3;

const cellKey = (x, y) => `${x},${y}`;

function blastAt(cx, cy, range = 2) {
  const cells = [{ x: cx, y: cy }];
  const walls = [];
  DIRS.forEach(({ dx, dy }) => {
    for (let dist = 1; dist <= range; dist++) {
      const x = cx + dx * dist;
      const y = cy + dy * dist;
      if (x < 0 || x >= cols || y < 0 || y >= rows) break;

      const isMapWall = map[y][x] === "0";
      const isBlocked = bombermanBlocked[y][x];

      if (isMapWall || isBlocked) {
        if (isActivePillar(x, y) && isPillarPassable(x, y)) {
          cells.push({ x, y });
          continue;
        }
        walls.push({ x, y });
        break;
      }
      cells.push({ x, y });
    }
  });
  return { cells, walls };
}

function buildThreats(extraBombs = []) {
  const danger = new Set();
  const wallThreat = new Set();

  const absorb = ({ cells, walls }) => {
    cells.forEach((c) => danger.add(cellKey(c.x, c.y)));
    walls.forEach((w) => {
      if (isRing(w.x, w.y, game.misobonRingInset)) wallThreat.add(cellKey(w.x, w.y));
    });
  };

  const allBombs = [...bombs.map((b) => ({ x: b.x, y: b.y })), ...extraBombs];
  const exploded = new Set();
  const queue = [...allBombs];
  while (queue.length > 0) {
    const b = queue.shift();
    const k = cellKey(b.x, b.y);
    if (exploded.has(k)) continue;
    exploded.add(k);

    const blast = blastAt(b.x, b.y, 2);
    absorb(blast);
    blast.cells.forEach((c) => {
      allBombs.forEach((other) => {
        if (other.x === c.x && other.y === c.y) queue.push(other);
      });
    });
  }

  activeChargeShots.forEach((shot) => {
    absorb(blastAt(shot.endX, shot.endY, 2));
    if (shot.trigger && !shot.triggerApplied) {
      getChargeSpreadCells(shot.trigger).forEach((c) => wallThreat.add(cellKey(c.x, c.y)));
    }
  });

  const addLaser = (sx, sy, dx, dy, distance) => {
    for (let i = 0; i <= distance; i++) {
      const blast = blastAt(sx + dx * i, sy + dy * i, balance.laserBlastRange);
      blast.cells.forEach((c) => danger.add(cellKey(c.x, c.y)));
    }
  };
  activeMisobonLasers.forEach((l) => addLaser(l.startX, l.startY, l.dx, l.dy, l.distance));
  misobons.forEach((mb) => {
    if (!mb.alive || mb.mode === "off" || !mb.laserAiming || !mb.aimAxis) return;
    addLaser(mb.x, mb.y, mb.aimDx, mb.aimDy, mb.aimDistance);
  });

  return { danger, wallThreat };
}

function findEscapeStep(bm, danger, maxSteps = Infinity) {
  const visited = new Set([cellKey(bm.x, bm.y)]);
  let frontier = [{ x: bm.x, y: bm.y, first: null, steps: 0 }];
  let bestFallback = null;

  while (frontier.length > 0) {
    const next = [];
    for (const node of frontier) {
      for (const d of shuffled(DIRS)) {
        const nx = node.x + d.dx;
        const ny = node.y + d.dy;
        const k = cellKey(nx, ny);
        if (visited.has(k)) continue;
        if (!canMoveBomberman(bm, nx, ny)) continue;
        visited.add(k);

        const first = node.first || d;
        const steps = node.steps + 1;
        if (!bestFallback) {
          bestFallback = { first, steps };
        }
        if (!danger.has(k)) return { first, steps };
        if (steps < maxSteps) next.push({ x: nx, y: ny, first, steps });
      }
    }
    frontier = next;
  }
  return bestFallback;
}

function findChargeTarget(bm) {
  for (const m of misobons) {
    if (!m.alive || m.mode === "off") continue;

    let dx = 0;
    let dy = 0;
    if (m.y === bm.y && m.x !== bm.x) dx = Math.sign(m.x - bm.x);
    else if (m.x === bm.x && m.y !== bm.y) dy = Math.sign(m.y - bm.y);
    else continue;

    let clear = 0;
    while (true) {
      const x = bm.x + dx * (clear + 1);
      const y = bm.y + dy * (clear + 1);
      const passable = isFloor(x, y) || isPillarPassable(x, y);
      if (!passable || bombermanBlocked[y][x]) break;
      clear++;
    }

    const dist = Math.abs(m.x - bm.x) + Math.abs(m.y - bm.y);
    if (clear >= CHARGE_MIN_CLEAR_STEPS && dist === clear + 1) {
      return { dx, dy, clear };
    }
  }
  return null;
}

// ---- 動けないみそボン(四隅などで、歩くこともジャンプすることもできない)を、チャージショットで狙う ----
// 隅のマスには床から一直線に撃てない。2段階目のチャージが「ひび割れた/壊れた壁」に触れたときの
// 飛び火(同じ外周の2マス先まで)で隅のマスを削るしかない。直線で当てる従来の狙い(findChargeTarget)では届かないので、別に探す。
const IMMOBILE_APPROACH_MAX_STEPS = 14;

export function isMisobonImmobile(m) {
  if (!m.alive || m.mode === "off" || m.jumpInProgress) return false;
  return DIRS.every((d) =>
    !isRingCellOpen(m.x + d.dx, m.y + d.dy) && !isRingCellOpen(m.x + d.dx * 2, m.y + d.dy * 2)
  );
}

// (x,y) から (dx,dy) へ2段階目を撃ったとき、飛び火が動けないみそボン m のマスに届くか。
// 動けない = 周囲の外周の壁(2マス以内)がすべて完全破壊済み。撃った弾はその壊れた壁を通り抜けるとき飛び火を起こす(chargeShot.js)
function immobileShotHits(x, y, dx, dy, m) {
  const out = computeShotOutcome({ x, y }, dx, dy, 2);
  return !!out.trigger && getChargeSpreadCells(out.trigger).some((c) => c.x === m.x && c.y === m.y);
}

function findImmobileChargeTarget(bm) {
  for (const m of misobons) {
    if (!isMisobonImmobile(m)) continue;
    for (const d of DIRS) {
      if (immobileShotHits(bm.x, bm.y, d.dx, d.dy, m)) return { dx: d.dx, dy: d.dy, clear: 99 }; // clear 99 = 2段階目まで溜める
    }
  }
  return null;
}

// 撃てる位置まで、危険でないマスだけを通って近づく最初の一歩(いまの位置から撃てるなら null)
function findImmobileApproachStep(bm, danger) {
  const targets = misobons.filter(isMisobonImmobile);
  if (targets.length === 0) return null;
  const visited = new Set([cellKey(bm.x, bm.y)]);
  let frontier = [{ x: bm.x, y: bm.y, first: null, steps: 0 }];
  while (frontier.length > 0) {
    const next = [];
    for (const node of frontier) {
      for (const d of shuffled(DIRS)) {
        const nx = node.x + d.dx, ny = node.y + d.dy;
        const k = cellKey(nx, ny);
        if (visited.has(k) || danger.has(k)) continue;
        if (!canMoveBomberman(bm, nx, ny)) continue;
        visited.add(k);
        const first = node.first || d;
        const steps = node.steps + 1;
        for (const m of targets) {
          for (const sd of DIRS) {
            if (immobileShotHits(nx, ny, sd.dx, sd.dy, m)) return first;
          }
        }
        if (steps < IMMOBILE_APPROACH_MAX_STEPS) next.push({ x: nx, y: ny, first, steps });
      }
    }
    frontier = next;
  }
  return null;
}

function findRingBombTarget(bm) {
  let best = null;
  DIRS.forEach((d) => {
    for (let dist = 1; dist <= 2; dist++) {
      const x = bm.x + d.dx * dist;
      const y = bm.y + d.dy * dist;
      if (x < 0 || x >= cols || y < 0 || y >= rows) return;

      if (isActivePillar(x, y)) {
        if (isPillarPassable(x, y)) continue;
        return;
      }

      const isWall = map[y][x] === "0" || bombermanBlocked[y][x];
      if (!isWall) continue;
      if (isRing(x, y, game.misobonRingInset) && wallDamage[y][x] < 2) {
        const score = wallDamage[y][x];
        if (!best || score > best.score) best = { dx: d.dx, dy: d.dy, score };
      }
      return;
    }
  });
  return best;
}

function allyCaughtInBlast(bm, blastCells) {
  return bombermen.some(
    (other) =>
      other !== bm &&
      other.alive &&
      other.mode !== "off" &&
      blastCells.some((c) => c.x === other.x && c.y === other.y)
  );
}

function findNearestMisobon(bm) {
  let best = null;
  misobons.forEach((m) => {
    if (!m.alive || m.mode === "off") return;
    const d = Math.abs(m.x - bm.x) + Math.abs(m.y - bm.y);
    if (!best || d < best.d) best = { m, d };
  });
  return best ? best.m : null;
}

function updateBombermanNpc(bm, now, danger) {
  if (!bm.alive || bm.mode !== "npc") return;

  if (bm.charging && now - bm.chargeStartTime > CHARGE_STAGE_2_WAIT_MS + 1500) {
    dispatchAction(bm.keyId, "CHARGE_CANCEL");
  }
  if (!bm.charging && bm.immobilized && !activeChargeShots.some((shot) => shot.bm === bm)) {
    bm.immobilized = false;
  }

  if (bm.immobilized && !bm.charging) return;

  const isDangerous = danger.has(cellKey(bm.x, bm.y));

  if (isDangerous) {
    if (bm.charging) dispatchAction(bm.keyId, "CHARGE_CANCEL");

    const escape = findEscapeStep(bm, danger);
    if (escape) {
      dispatchAction(bm.keyId, "MOVE", { dx: escape.first.dx, dy: escape.first.dy });
      return;
    }

    const movable = shuffled(DIRS).find((d) => canMoveBomberman(bm, bm.x + d.dx, bm.y + d.dy));
    if (movable) {
      dispatchAction(bm.keyId, "MOVE", { dx: movable.dx, dy: movable.dy });
      return;
    }
  }

  // 直線で狙える相手が先。次に、動けないみそボン(四隅など)への飛び火狙い
  const target = findChargeTarget(bm) || findImmobileChargeTarget(bm);
  if (target) {
    if (!bm.charging) {
      dispatchAction(bm.keyId, "CHARGE_START");
      if (bm.charging) dispatchAction(bm.keyId, "CHARGE_DIR", { dx: target.dx, dy: target.dy });
      return;
    }
    dispatchAction(bm.keyId, "CHARGE_DIR", { dx: target.dx, dy: target.dy });
    const need = target.clear <= 3 ? CHARGE_STAGE_1_WAIT_MS : CHARGE_STAGE_2_WAIT_MS;
    if (now - bm.chargeStartTime >= need) {
      dispatchAction(bm.keyId, "CHARGE_RELEASE");
    }
    return;
  }
  if (bm.charging) {
    dispatchAction(bm.keyId, "CHARGE_CANCEL");
    return;
  }

  if (bm.bombsActive < balance.maxBombs) {
    const ringTarget = findRingBombTarget(bm);
    if (ringTarget) {
      const { cells: blastCells } = blastAt(bm.x, bm.y, 2);
      if (!allyCaughtInBlast(bm, blastCells)) {
        const { danger: dangerAfter } = buildThreats([{ x: bm.x, y: bm.y }]);
        const escape = findEscapeStep(bm, dangerAfter, BOMB_ESCAPE_MAX_STEPS);
        if (escape && random() < 0.3) {
          dispatchAction(bm.keyId, "PLACE_BOMB");
          return;
        }
      }
    }
  }

  if (now - bm.lastMoveTime >= BOMBERMAN_MOVE_INTERVAL_MS) {
    const nearest = findNearestMisobon(bm);
    const dirs = shuffled(DIRS);
    const approach = findImmobileApproachStep(bm, danger);
    if (approach) {
      // 動けないみそボンを撃てる位置へ向かう
      dispatchAction(bm.keyId, "MOVE", { dx: approach.dx, dy: approach.dy });
      return;
    }
    if (nearest) {
      dirs.sort((a, b) => {
        const distA = Math.hypot(bm.x + a.dx - nearest.x, bm.y + a.dy - nearest.y);
        const distB = Math.hypot(bm.x + b.dx - nearest.x, bm.y + b.dy - nearest.y);
        return distA - distB;
      });
    }

    for (const d of dirs) {
      const nx = bm.x + d.dx;
      const ny = bm.y + d.dy;
      if (canMoveBomberman(bm, nx, ny) && !danger.has(cellKey(nx, ny))) {
        dispatchAction(bm.keyId, "MOVE", { dx: d.dx, dy: d.dy });
        break;
      }
    }
  }
}

function updateMisobonNpc(mb, now, wallThreat) {
  if (!mb.alive || mb.mode !== "npc") return;
  if (mb.jumpInProgress) return;

  if (mb.laserAiming) {
    const neededHold = mb.npcNeedsCharge ? MISOBON_CHARGE_WAIT_MS + 50 : Math.max(NPC_AIM_HOLD_MS, balance.laserMinAimMs);
    if (now - (mb.aimStartTime || 0) >= neededHold) {
      dispatchAction(mb.keyId, "AIM_RELEASE");
      mb.npcNeedsCharge = false;
    }
    return;
  }

  const isDangerous = wallThreat.has(cellKey(mb.x, mb.y));

  if (isDangerous && now - mb.lastMoveTime >= getMisobonMoveInterval(mb)) {
    for (const d of DIRS) {
      const nx = mb.x + d.dx;
      const ny = mb.y + d.dy;
      if (canMoveMisobon(mb, nx, ny) && !wallThreat.has(cellKey(nx, ny))) {
        dispatchAction(mb.keyId, "MOVE", { dx: d.dx, dy: d.dy });
        return;
      }
    }
    for (const d of DIRS) {
      dispatchAction(mb.keyId, "JUMP", { dx: d.dx, dy: d.dy });
      if (mb.jumpInProgress) return;
    }
  }

  const dir = getMisobonLaserDirection(mb);
  if (dir && !mb.laserCooldown) {
    const aliveBm = bombermen.filter((b) => b.alive && b.mode !== "off");
    const maxRange = getMisobonMaxRange(dir.axis);

    const onLineBm = aliveBm.find((b) => {
      const aligned = dir.axis === "horizontal" ? b.y === mb.y : b.x === mb.x;
      if (!aligned) return false;
      const dist = dir.axis === "horizontal" ? (b.x - mb.x) * dir.dx : (b.y - mb.y) * dir.dy;
      return dist >= 3 && dist <= maxRange;
    });

    if (onLineBm) {
      const targetDist = Math.abs(dir.axis === "horizontal" ? onLineBm.x - mb.x : onLineBm.y - mb.y);

      let hasPillarOnLine = false;
      for (let s = 1; s < targetDist; s++) {
        const sx = mb.x + dir.dx * s;
        const sy = mb.y + dir.dy * s;
        if (isActivePillar(sx, sy) && !isPillarPassable(sx, sy)) {
          hasPillarOnLine = true;
          break;
        }
      }

      dispatchAction(mb.keyId, "AIM_START");
      if (mb.laserAiming) {
        dispatchAction(mb.keyId, "AIM_SET_DIST", { distance: targetDist });
        mb.aimStartTime = now;
        mb.npcNeedsCharge = hasPillarOnLine;
      }
      return;
    }
  }

  if (now - mb.lastMoveTime >= getMisobonMoveInterval(mb)) {
    const targetBm = bombermen.find((b) => b.alive && b.mode !== "off");
    const dirs = shuffled(DIRS);

    if (targetBm) {
      dirs.sort((a, b) => {
        const distA = Math.hypot(mb.x + a.dx - targetBm.x, mb.y + a.dy - targetBm.y);
        const distB = Math.hypot(mb.x + b.dx - targetBm.x, mb.y + b.dy - targetBm.y);
        return distA - distB;
      });
    }

    let moved = false;
    for (const d of dirs) {
      const nx = mb.x + d.dx;
      const ny = mb.y + d.dy;
      if (canMoveMisobon(mb, nx, ny) && !wallThreat.has(cellKey(nx, ny))) {
        dispatchAction(mb.keyId, "MOVE", { dx: d.dx, dy: d.dy });
        moved = true;
        break;
      }
    }

    if (!moved && random() < 0.4) {
      for (const d of dirs) {
        dispatchAction(mb.keyId, "JUMP", { dx: d.dx, dy: d.dy });
        if (mb.jumpInProgress) break;
      }
    }
  }
}

export const STALL_THRESHOLD_MS = 6000;

// 停止検知の記録(測定モードがレポートに使う)。検知の挙動自体は変えない。
export const stallLog = [];

export function checkNpcStalls(now, matchIndex = 0) {
  if (!game.gameStarted || game.over) return [];
  const stalls = [];

  const checkChar = (char) => {
    if (!char.alive || char.mode !== "npc") return;
    if (char.lastActionTime === 0) char.lastActionTime = now;
    const idleTime = now - char.lastActionTime;

    if (idleTime >= STALL_THRESHOLD_MS && !char.stalled) {
      char.stalled = true;
      const details = {
        matchIndex: matchIndex + 1,
        timeSec: (now / 1000).toFixed(1),
        name: char.name,
        role: char.role,
        pos: { x: char.x, y: char.y },
        idleMs: idleTime,
        charging: char.charging || false,
        immobilized: char.immobilized || false,
        laserAiming: char.laserAiming || false,
        jumpInProgress: char.jumpInProgress || false
      };
      stalls.push(details);
      stallLog.push(details);
      if (!game.silentMode) console.warn(
        `[NPC停止検知] 試合#${details.matchIndex} (${details.timeSec}秒): ${char.name} が (${char.x}, ${char.y}) で ${(idleTime / 1000).toFixed(1)}秒間停止中!`,
        details
      );
    }
  };

  bombermen.forEach(checkChar);
  misobons.forEach(checkChar);
  return stalls;
}

export function updateAi(matchIndex = 0) {
  const now = clock.now();
  const { danger, wallThreat } = buildThreats();

  bombermen.forEach((bm) => updateBombermanNpc(bm, now, danger));
  misobons.forEach((mb) => updateMisobonNpc(mb, now, wallThreat));

  checkNpcStalls(now, matchIndex);
}
