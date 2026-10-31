// 基準データの再現(2対2・100試合・seed 20261012)。ブラウザ測定と一致する値: 55 / 44 / 1
import test from "node:test";
import assert from "node:assert/strict";
import { runMeasurement } from "../js/measureMode.js";
import { bombermen, misobons } from "../js/state.js";

test("2対2 基準: ボンバーマン55 / みそボン44 / 引き分け1", async () => {
  bombermen.forEach((b, i) => { b.mode = i < 2 ? "npc" : "off"; });
  misobons.forEach((m, i) => { m.mode = i < 2 ? "npc" : "off"; });
  const log = console.log; console.log = () => {};
  const report = await new Promise((res, rej) => runMeasurement({ matchCount: 100, onProgress() {}, onDone: (s, r) => res(r), onError: rej }));
  console.log = log;
  assert.deepEqual([report.scores.bombermanWins, report.scores.misobonWins, report.scores.draws], [55, 44, 1]);
  const e = report.endReasons;
  assert.equal(e.bombermanWipeout + e.misobonWipeout + e.timeup + e.simultaneous, 100);
  assert.equal(e.timeup, 1);
});
