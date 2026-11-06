// js/suddenDeath.js
import { clock } from "./clock.js";
import { bombermen, misobons, game, bombermanBlocked } from "./state.js";
import { isRing, clampToRing, rows, cols } from "./mapData.js";
import { killBomberman } from "./bomberman.js";
import { cancelBombermanCharge } from "./chargeShot.js";
import { cancelMisobonAim } from "./misobonLaser.js";
import { balance } from "./balance.js";
import { emitEvent } from "./events.js";

const FIRST_STAGE_DELAY_MS = 20000;
const STAGE_INTERVAL_MS = 10000;

function canShrinkTo(newInset) {
  const width = cols - 2 * newInset;
  const height = rows - 2 * newInset;
  return width >= 3 && height >= 3;
}

function applySuddenDeathStage(newInset) {
  const oldInset = game.misobonRingInset;

  misobons.forEach((mb) => cancelMisobonAim(mb));
  bombermen.forEach((bm) => {
    if (bm.alive && bm.mode !== "off") {
      cancelBombermanCharge(bm);
      bm.charging = false;
      bm.immobilized = false;
    }
  });

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (isRing(x, y, newInset)) {
        bombermanBlocked[y][x] = true;
      }
    }
  }

  misobons.forEach((mb) => {
    if (!mb.alive || mb.mode === "off") return;
    const snapped = clampToRing(mb.x, mb.y, newInset);
    mb.x = snapped.x;
    mb.y = snapped.y;
  });

  game.misobonRingInset = newInset;
  game.suddenDeathStage += 1;

  emitEvent("SUDDEN_DEATH_STAGE", { stage: game.suddenDeathStage, inset: newInset });

  bombermen.forEach((bm) => {
    if (bm.alive && bm.mode !== "off" && isRing(bm.x, bm.y, newInset)) {
      killBomberman(bm, `${bm.name} はサドンデスの壁に飲み込まれた!`);
    }
  });
}

let activeTimerId = null;
let countdownInfo = null;

// 次のサドンデス段階までの残り(スナップショット用)。無ければ null
export function getSuddenDeathCountdown() {
  return countdownInfo ? { ...countdownInfo } : null;
}

function scheduleStage(delayMs) {
  const maxStage = balance.suddenDeathMaxStage ?? Infinity;
  const nextStage = game.suddenDeathStage + 1;
  if (nextStage > maxStage) return;

  let remaining = Math.ceil(delayMs / 1000);
  countdownInfo = { nextStage, remainingSec: remaining };
  emitEvent("SUDDEN_DEATH_COUNTDOWN", { nextStage, remainingSec: remaining });

  activeTimerId = clock.setInterval(() => {
    if (game.over) {
      clock.clearInterval(activeTimerId);
      activeTimerId = null;
      countdownInfo = null;
      return;
    }

    remaining -= 1;
    if (remaining > 0) {
      countdownInfo = { nextStage, remainingSec: remaining };
      emitEvent("SUDDEN_DEATH_COUNTDOWN", { nextStage, remainingSec: remaining });
      return;
    }
    clock.clearInterval(activeTimerId);
    activeTimerId = null;
    countdownInfo = null;

    const nextInset = game.misobonRingInset + 1;
    if (!canShrinkTo(nextInset)) return;

    applySuddenDeathStage(nextInset);
    if (game.over) return;

    if (game.suddenDeathStage >= maxStage) return;

    scheduleStage(STAGE_INTERVAL_MS);
  }, 1000);
}

export function startSuddenDeathSchedule() {
  game.suddenDeathStage = 0;
  const maxStage = balance.suddenDeathMaxStage ?? Infinity;
  if (maxStage <= 0) return;
  scheduleStage(FIRST_STAGE_DELAY_MS);
}

export function stopSuddenDeathSchedule() {
  countdownInfo = null;
  if (activeTimerId) {
    clock.clearInterval(activeTimerId);
    activeTimerId = null;
  }
}
