// js/matchTimer.js
// 試合の制限時間(ロジックのみ。画面表示は viewEvents.js が MATCH_TIMER / MATCH_TIME_UP を受けて行う)
import { clock } from "./clock.js";
import { balance } from "./balance.js";
import { endGameByTimeout } from "./matchRules.js";
import { game } from "./state.js";
import { emitEvent } from "./events.js";

let endTimer = null;
let tickTimer = null;
let startedAt = 0;

export function getMatchRemainingMs() {
  return Math.max(0, balance.matchTimeLimitMs - (clock.now() - startedAt));
}

function emitTimerTick() {
  if (game.silentMode) return;
  emitEvent("MATCH_TIMER", { remainingMs: getMatchRemainingMs(), limitMs: balance.matchTimeLimitMs });
}

export function startMatchTimer() {
  stopMatchTimer();
  startedAt = clock.now();
  endTimer = clock.setTimeout(() => {
    endTimer = null;
    stopMatchTimer();
    if (!game.silentMode) emitEvent("MATCH_TIME_UP", {});
    endGameByTimeout();
  }, balance.matchTimeLimitMs);
  if (!game.silentMode) {
    tickTimer = clock.setInterval(emitTimerTick, 250);
    emitTimerTick();
  }
}

export function stopMatchTimer() {
  clock.clearTimeout(endTimer);
  clock.clearInterval(tickTimer);
  endTimer = null;
  tickTimer = null;
}
