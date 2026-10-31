// js/matchRules.js
import { bombermen, misobons, game, recordResult } from "./state.js";
import { stopSuddenDeathSchedule } from "./suddenDeath.js";
import { stopMatchTimer } from "./matchTimer.js";
import { clock } from "./clock.js";
import { emitEvent } from "./events.js";

export function checkMatchResult() {
  if (game.over || !game.gameStarted) return;

  const bmAlive = bombermen.filter((b) => b.alive && b.mode !== "off").length;
  const bmTotal = bombermen.filter((b) => b.mode !== "off").length;
  const mbAlive = misobons.filter((m) => m.alive && m.mode !== "off").length;
  const mbTotal = misobons.filter((m) => m.mode !== "off").length;

  if (bmTotal === 0 || mbTotal === 0) return;

  if (bmAlive === 0 && mbAlive === 0) {
    endMatch(null, "draw");
  } else if (bmAlive === 0) {
    endMatch("misobon", "wipeout");
  } else if (mbAlive === 0) {
    endMatch("bomberman", "wipeout");
  }
}

export function endGameByTimeout() {
  if (game.over || !game.gameStarted) return;
  const bmTotal = bombermen.filter((b) => b.mode !== "off").length;
  const mbTotal = misobons.filter((m) => m.mode !== "off").length;
  if (bmTotal === 0 || mbTotal === 0) return;
  endMatch(null, "timeup");
}

export function endMatch(winnerSide, reason = "") {
  if (game.over) return;
  game.over = true;

  stopSuddenDeathSchedule();
  stopMatchTimer();
  clock.cancelAll();

  const bucket = game.matchMode;
  let resultText;
  if (winnerSide === "bomberman") {
    recordResult(bucket, "bomberman");
    resultText = "みそボン全滅! 【ボンバーマン陣営の勝利!】";
  } else if (winnerSide === "misobon") {
    recordResult(bucket, "misobon");
    resultText = "ボンバーマン全滅! 【みそボン陣営の勝利!】";
  } else if (reason === "timeup") {
    recordResult(bucket, "draw");
    resultText = "時間切れ! 【引き分け】";
  } else {
    recordResult(bucket, "draw");
    resultText = "両陣営同時に全滅… 引き分け";
  }

  emitEvent("GAME_OVER", {
    winner: winnerSide,
    reason,
    resultText,
    matchMode: bucket
  });
}
