// 同じシードなら、何度走らせても試合ごとの結果が完全に同じになること
import test from "node:test";
import assert from "node:assert/strict";
import { runMeasurement } from "../js/measureMode.js";
import { bombermen, misobons } from "../js/state.js";

function run(count, baseSeed) {
  const log = console.log; console.log = () => {};
  return new Promise((res, rej) => runMeasurement({
    matchCount: count, baseSeed, onProgress() {}, onError: rej,
    onDone: (s, r) => { console.log = log; res(r.matches.map((m) => `${m.seed}:${m.winner}:${m.reason}:${m.durationMs}`)); }
  }));
}

test("同一シードで2回走らせると、全試合の勝者・終了理由・試合時間が一致する", async () => {
  bombermen.forEach((b, i) => { b.mode = i < 2 ? "npc" : "off"; });
  misobons.forEach((m, i) => { m.mode = i < 2 ? "npc" : "off"; });
  const a = await run(12, 777);
  const b = await run(12, 777);
  assert.deepEqual(a, b);
  const c = await run(12, 778);
  assert.notDeepEqual(a, c, "シードを変えても全く同じ結果になっている(乱数が効いていない可能性)");
});
