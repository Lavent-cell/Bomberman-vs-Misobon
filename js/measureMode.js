// js/measureMode.js
import { clock } from "./clock.js";
import { game, scores, resetScore, bombermen, misobons } from "./state.js";
import { resetMatch } from "./matchReset.js";
import { startMatchLogic } from "./matchStart.js";
import { stepGame } from "./movementLoop.js";
import { endGameByTimeout } from "./matchRules.js";
import { balance } from "./balance.js";
import { checkNpcStalls, stallLog } from "./ai.js";
import { addEventListener, removeEventListener } from "./events.js";

const TICK_MS = 16;
const MAX_MATCH_MS = balance.matchTimeLimitMs + 5000;
const DEFAULT_BASE_SEED = 20261012;

function makeVirtualBackend() {
  let t = 0;
  const timers = new Map();
  let seq = 1;

  return {
    now: () => t,
    setTimeout: (fn, ms) => {
      const id = seq++;
      timers.set(id, { at: t + ms, fn, rep: 0 });
      return id;
    },
    clearTimeout: (h) => timers.delete(h),
    setInterval: (fn, ms) => {
      const id = seq++;
      timers.set(id, { at: t + ms, fn, rep: ms });
      return id;
    },
    clearInterval: (h) => timers.delete(h),
    requestFrame: (fn) => {
      const id = seq++;
      timers.set(id, { at: t + TICK_MS, fn: () => fn(t + TICK_MS), rep: 0 });
      return id;
    },
    cancelFrame: (h) => timers.delete(h),
    advance(ms) {
      const end = t + ms;
      for (;;) {
        let best = null;
        for (const [id, tm] of timers) {
          if (tm.at <= end && (!best || tm.at < best.tm.at)) {
            best = { id, tm };
          }
        }
        if (!best) break;
        t = best.tm.at;
        if (best.tm.rep) {
          best.tm.at += best.tm.rep;
        } else {
          timers.delete(best.id);
        }
        best.tm.fn();
      }
      t = end;
    }
  };
}

export function runMeasurement({ matchCount, onProgress, onDone, onError, baseSeed = DEFAULT_BASE_SEED }) {
  const bmCount = bombermen.filter((b) => b.mode !== "off").length;
  const mbCount = misobons.filter((m) => m.mode !== "off").length;
  if (bmCount === 0 || mbCount === 0) {
    if (onError) onError("ボンバーマンとみそボンを、それぞれ1人以上 OFF 以外にしてください");
    return;
  }

  resetScore("measure");

  const savedBmModes = bombermen.map((b) => b.mode);
  const savedMbModes = misobons.map((m) => m.mode);

  bombermen.forEach((b) => { if (b.mode === "player") b.mode = "npc"; });
  misobons.forEach((m) => { if (m.mode === "player") m.mode = "npc"; });

  clock.cancelAll();
  const vb = makeVirtualBackend();
  clock.setBackend(vb);

  let matchIndex = 0;
  let totalStalls = 0;
  const matchLog = [];
  const endReasons = { bombermanWipeout: 0, misobonWipeout: 0, timeup: 0, simultaneous: 0 };
  let lastGameOver = null;
  const onGameOver = (ev) => { if (ev.type === "GAME_OVER") lastGameOver = ev; };
  addEventListener(onGameOver);

  function runNext() {
    if (matchIndex >= matchCount) {
      bombermen.forEach((b, i) => { b.mode = savedBmModes[i]; });
      misobons.forEach((m, i) => { m.mode = savedMbModes[i]; });

      removeEventListener(onGameOver);
      clock.cancelAll();
      clock.useRealBackend();
      resetMatch();

      const totalMatches = scores.measure.bomberman + scores.measure.misobon + scores.measure.draw;
      const bmRate = totalMatches > 0 ? ((scores.measure.bomberman / totalMatches) * 100).toFixed(1) : "0.0";
      const mbRate = totalMatches > 0 ? ((scores.measure.misobon / totalMatches) * 100).toFixed(1) : "0.0";

      const baselineReport = {
        baselineVersion: "Phase1-e",
        timestamp: new Date().toISOString(),
        baseSeed,
        matchCount,
        roster: { bomberman: bmCount, misobon: mbCount },
        suddenDeathMaxStage: balance.suddenDeathMaxStage,
        matchTimeLimitMs: balance.matchTimeLimitMs,
        scores: {
          bombermanWins: scores.measure.bomberman,
          misobonWins: scores.measure.misobon,
          draws: scores.measure.draw,
          bombermanWinRate: `${bmRate}%`,
          misobonWinRate: `${mbRate}%`
        },
        stallCount: totalStalls,
        reportVersion: 2,
        endReasons,
        avgMatchSec: matchLog.length ? Number((matchLog.reduce((a, m) => a + m.durationMs, 0) / matchLog.length / 1000).toFixed(1)) : 0,
        suddenDeathReached: matchLog.filter((m) => m.suddenDeathStage > 0).length,
        matches: matchLog
      };

      console.log("==========================================");
      console.log("【Phase1-e 基準データ測定完了】");
      console.log(JSON.stringify(baselineReport, null, 2));
      console.log("==========================================");

      onDone(scores.measure, baselineReport);
      return;
    }

    resetMatch();
    startMatchLogic({ seed: baseSeed + matchIndex * 10007, matchMode: "measure", silent: true });

    const matchStartedAt = clock.now();
    lastGameOver = null;
    stallLog.length = 0;

    const maxTicks = Math.ceil(MAX_MATCH_MS / TICK_MS);
    for (let i = 0; i < maxTicks; i++) {
      vb.advance(TICK_MS);
      stepGame();
      checkNpcStalls(clock.now(), matchIndex);
      if (game.over) break;
    }
    if (!game.over) {
      endGameByTimeout();
    }

    totalStalls += stallLog.length;
    const reason = lastGameOver ? lastGameOver.reason : "unknown";
    const winner = lastGameOver ? lastGameOver.winner : null;
    if (reason === "timeup") endReasons.timeup++;
    else if (winner === "bomberman") endReasons.bombermanWipeout++;
    else if (winner === "misobon") endReasons.misobonWipeout++;
    else endReasons.simultaneous++;
    matchLog.push({
      index: matchIndex,
      seed: baseSeed + matchIndex * 10007,
      winner: winner || "draw",
      reason,
      durationMs: Math.round(clock.now() - matchStartedAt),
      suddenDeathStage: game.suddenDeathStage,
      aliveBombermen: bombermen.filter((b) => b.alive && b.mode !== "off").length,
      aliveMisobons: misobons.filter((m) => m.alive && m.mode !== "off").length,
      stalls: stallLog.map((s) => ({ name: s.name, timeSec: s.timeSec, pos: s.pos, idleMs: s.idleMs }))
    });

    matchIndex++;
    onProgress(matchIndex, matchCount, scores.measure, { bomberman: bmCount, misobon: mbCount });

    clock.useRealBackend();
    if (typeof window !== "undefined") {
      window.setTimeout(() => {
        clock.setBackend(vb);
        runNext();
      }, 0);
    } else {
      setImmediate(() => {
        clock.setBackend(vb);
        runNext();
      });
    }
  }

  runNext();
}
