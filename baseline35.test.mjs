// 3対5(全員NPC)の基準データ: ボンバーマン44 / みそボン55 / 引き分け1(ブラウザ測定と一致)
import test from "node:test";
import assert from "node:assert/strict";
import { runMeasurement } from "../js/measureMode.js";
import { bombermen, misobons } from "../js/state.js";

test("3対5 基準: ボンバーマン44 / みそボン55 / 引き分け1", async () => {
  bombermen.forEach((b) => { b.mode = "npc"; });
  misobons.forEach((m) => { m.mode = "npc"; });
  const log = console.log; console.log = () => {};
  const report = await new Promise((res, rej) => runMeasurement({ matchCount: 100, onProgress() {}, onDone: (s, r) => res(r), onError: rej }));
  console.log = log;
  assert.deepEqual([report.scores.bombermanWins, report.scores.misobonWins, report.scores.draws], [44, 55, 1]);
  assert.equal(report.endReasons.timeup, 1);
});
