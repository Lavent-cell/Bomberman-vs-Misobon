// js/snapshot.js
// 試合状態のスナップショット(DOM非依存。サーバーが作り、クライアントが映す)
// 時間に関する値はすべて「経過ミリ秒」「残りミリ秒」で持つ(端末ごとの時計の違いに依存しないため)。
import { clock } from "./clock.js";
import { game, bombermen, misobons, bombs, wallDamage, pillarDamage, bombermanBlocked } from "./state.js";
import { getLatestEventId } from "./events.js";
import { getMatchRemainingMs } from "./matchTimer.js";
import { getSuddenDeathCountdown } from "./suddenDeath.js";
import { activeChargeShots, getChargeStage } from "./chargeShot.js";
import { activeMisobonLasers } from "./misobonLaser.js";
import { balance } from "./balance.js";

let snapshotSeq = 0;

const encodeGrid = (grid, f = (v) => v) => grid.map((row) => row.map((v) => String(f(v))).join(""));

export function createSnapshot({ phase = "playing" } = {}) {
  const now = clock.now();
  return {
    type: "SNAPSHOT",
    seq: ++snapshotSeq,
    latestEventId: getLatestEventId(),
    phase,
    game: {
      gameStarted: game.gameStarted,
      over: game.over,
      suddenDeathStage: game.suddenDeathStage,
      misobonRingInset: game.misobonRingInset,
      matchRemainingMs: game.gameStarted && !game.over ? Math.round(getMatchRemainingMs()) : null,
      suddenDeathCountdown: game.gameStarted && !game.over ? getSuddenDeathCountdown() : null
    },
    bombermen: bombermen.map((b) => ({
      id: b.id, keyId: b.keyId, x: b.x, y: b.y,
      alive: b.alive, mode: b.mode, facing: { ...b.facing },
      charging: b.charging,
      chargeElapsedMs: b.charging ? Math.round(now - b.chargeStartTime) : 0,
      chargeStage: b.charging ? getChargeStage(now - b.chargeStartTime) : 0,
      immobilized: b.immobilized,
      bombsActive: b.bombsActive
    })),
    misobons: misobons.map((m) => ({
      id: m.id, keyId: m.keyId, x: m.x, y: m.y,
      alive: m.alive, mode: m.mode,
      jumpInProgress: m.jumpInProgress,
      jump: m.jumpState
        ? {
            fromX: m.jumpState.fromX, fromY: m.jumpState.fromY,
            toX: m.jumpState.toX, toY: m.jumpState.toY,
            elapsedMs: Math.round(now - m.jumpState.startTime),
            durationMs: m.jumpState.durationMs
          }
        : null,
      laserAiming: m.laserAiming,
      laserCharged: m.laserCharged,
      laserCooldown: m.laserCooldown,
      laserCooldownRemainingMs: m.laserCooldown ? Math.max(0, Math.round((m.laserCooldownEndsAt || 0) - now)) : 0,
      laserCooldownTotalMs: balance.laserCooldownMs,
      aimAxis: m.aimAxis, aimDx: m.aimDx, aimDy: m.aimDy, aimDistance: m.aimDistance
    })),
    bombs: bombs.map((b) => ({
      id: b.id, x: b.x, y: b.y,
      ownerKeyId: b.owner ? b.owner.keyId : null,
      remainingMs: Math.max(0, Math.round(b.explodeAt - now))
    })),
    chargeShots: activeChargeShots.map((s) => ({
      id: s.id, charKeyId: s.bm.keyId, stage: s.stage,
      startX: s.startX, startY: s.startY, endX: s.endX, endY: s.endY,
      elapsedMs: Math.round(now - s.startTime), durationMs: s.durationMs
    })),
    lasers: activeMisobonLasers.map((l) => ({
      id: l.id, ownerKeyId: l.ownerKeyId, isCharged: l.isCharged,
      startX: l.startX, startY: l.startY, dx: l.dx, dy: l.dy, distance: l.distance,
      elapsedMs: Math.round(now - l.startTime), durationMs: l.durationMs
    })),
    // 盤面は1行1文字列(各マス1桁)で持つ
    wallDamage: encodeGrid(wallDamage),
    pillarDamage: encodeGrid(pillarDamage),
    blocked: encodeGrid(bombermanBlocked, (v) => (v ? 1 : 0))
  };
}

export function decodeGrid(rows) {
  return rows.map((r) => [...r].map((c) => Number(c)));
}
