// js/matchStart.js
// 試合開始の論理処理(画面・音には触れない)。測定モードとサーバーが共有する。
import { game } from "./state.js";
import { setRngSeed } from "./random.js";
import { startSuddenDeathSchedule } from "./suddenDeath.js";
import { startMatchTimer } from "./matchTimer.js";
import { clock } from "./clock.js";
import { bombermen, misobons } from "./state.js";
import { emitEvent } from "./events.js";

// resetMatch() の後に呼ぶ。seed を渡すと乱数を固定する。
export function startMatchLogic({ seed = null, matchMode = "normal", silent = false } = {}) {
  if (seed !== null) setRngSeed(seed);

  game.matchMode = matchMode;
  game.silentMode = silent;
  game.gameStarted = true;

  const now = clock.now();
  [...bombermen, ...misobons].forEach((c) => {
    c.lastActionTime = now;
    c.stalled = false;
  });

  startSuddenDeathSchedule();
  startMatchTimer();

  if (!silent) emitEvent("MATCH_START", { matchMode });
}
