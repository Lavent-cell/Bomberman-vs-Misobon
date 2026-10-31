// js/matchReset.js
// 試合の論理リセット(DOM・描画・音には触れない)。
// 画面側のリセットは MATCH_RESET イベントを受けて viewEvents.js が行う。
import { clock } from "./clock.js";
import { resetMatchState, bombs } from "./state.js";
import { stopSuddenDeathSchedule } from "./suddenDeath.js";
import { stopMatchTimer } from "./matchTimer.js";
import { activeChargeShots } from "./chargeShot.js";
import { activeMisobonLasers } from "./misobonLaser.js";
import { balance } from "./balance.js";
import { emitEvent } from "./events.js";

export function resetMatch() {
  clock.cancelAll();
  stopSuddenDeathSchedule();
  stopMatchTimer();

  activeChargeShots.length = 0;
  activeMisobonLasers.length = 0;
  bombs.length = 0;

  resetMatchState();

  emitEvent("MATCH_RESET", { limitMs: balance.matchTimeLimitMs });
}
