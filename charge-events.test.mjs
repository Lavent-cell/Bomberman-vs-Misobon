// チャージ段階のイベントが、ロジック側の閾値どおりに出ること(画面はこのイベントを見て表示する)
import test from "node:test";
import assert from "node:assert/strict";
import { resetMatch } from "../js/matchReset.js";
import { startMatchLogic } from "../js/matchStart.js";
import { dispatchAction } from "../js/actions.js";
import { bombermen, misobons } from "../js/state.js";
import { addEventListener, removeEventListener } from "../js/events.js";
import { getChargeStage, CHARGE_STAGE_1_MS, CHARGE_STAGE_2_MS } from "../js/chargeShot.js";
import { MISOBON_CHARGE_WAIT_MS } from "../js/misobonLaser.js";
import { sleep } from "./helpers.mjs";

function record() {
  const seen = [];
  const t0 = Date.now();
  const fn = (e) => seen.push({ type: e.type, stage: e.stage, at: Date.now() - t0 });
  addEventListener(fn);
  return { seen, stop: () => removeEventListener(fn) };
}
function begin() {
  bombermen.forEach((b, i) => { b.mode = i === 0 ? "player" : "off"; });
  misobons.forEach((m, i) => { m.mode = i === 0 ? "player" : "off"; });
  resetMatch();
  startMatchLogic({ seed: 1 });
}

test("段階の閾値は 0.8秒 と 1.6秒", () => {
  assert.deepEqual([0, 799, 800, 1599, 1600, 5000].map(getChargeStage), [0, 0, 1, 1, 2, 2]);
});

test("ボンバーマン: 押し続けると 段階1 → 段階2 のイベントが順に出る / 離すと止まる", async () => {
  begin();
  const r = record();
  dispatchAction("b0", "CHARGE_START");
  await sleep(CHARGE_STAGE_2_MS + 250);
  const stages = r.seen.filter((e) => e.type === "CHARGE_STAGE");
  assert.deepEqual(stages.map((e) => e.stage), [1, 2]);
  assert.ok(stages[0].at >= CHARGE_STAGE_1_MS - 50 && stages[0].at < CHARGE_STAGE_1_MS + 200);
  assert.ok(stages[1].at >= CHARGE_STAGE_2_MS - 50 && stages[1].at < CHARGE_STAGE_2_MS + 200);
  dispatchAction("b0", "CHARGE_RELEASE");
  r.stop();
  resetMatch();
});

test("ボンバーマン: 途中で離す・キャンセルされると、それ以降の段階イベントは出ない", async () => {
  begin();
  const r = record();
  dispatchAction("b0", "CHARGE_START");
  await sleep(300);
  dispatchAction("b0", "CHARGE_RELEASE"); // 短押し = 爆弾
  await sleep(CHARGE_STAGE_2_MS + 200);
  assert.equal(r.seen.filter((e) => e.type === "CHARGE_STAGE").length, 0);
  r.stop();
  resetMatch();
});

test("みそボン: 照準を続けるとチャージ完了(AIM_CHARGED)が出る / 途中でやめると出ない", async () => {
  begin();
  const r = record();
  dispatchAction("m0", "AIM_START");
  assert.ok(r.seen.some((e) => e.type === "AIM_START"), "m0 は左の壁にいるので照準できる");
  await sleep(MISOBON_CHARGE_WAIT_MS + 250);
  assert.equal(r.seen.filter((e) => e.type === "AIM_CHARGED").length, 1);
  dispatchAction("m0", "AIM_CANCEL");
  r.seen.length = 0;
  dispatchAction("m0", "AIM_START");
  await sleep(300);
  dispatchAction("m0", "AIM_CANCEL");
  await sleep(MISOBON_CHARGE_WAIT_MS);
  assert.equal(r.seen.filter((e) => e.type === "AIM_CHARGED").length, 0);
  r.stop();
  resetMatch();
});
