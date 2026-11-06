// 動けないみそボン(四隅などで、歩くこともジャンプすることもできない)を、NPCボンバーマンがチャージショットで狙う。
// 従来は「みそボンの立つ壁へ直線で当てる」狙いしか無く、隅のマスには届かないため撃たず、
// 時間切れ(引き分け)かサドンデスでみそボン有利に終わっていた。
import test from "node:test";
import assert from "node:assert/strict";
import { bombermen, misobons, wallDamage } from "../js/state.js";
import { drainEvents } from "../js/events.js";
import { startMatchLogic } from "../js/matchStart.js";
import { resetMatch } from "../js/matchReset.js";
import { stepGame } from "../js/movementLoop.js";
import { isMisobonImmobile } from "../js/ai.js";
import { sleep } from "./helpers.mjs";

// 左上の隅(0,0)にみそボン。周囲の外周の壁(2マス以内)をすべて完全破壊して、動けなくする
function setupCorner({ bmX, bmY, destroyed = [[1, 0], [2, 0], [0, 1], [0, 2]] }) {
  resetMatch(); drainEvents();
  bombermen.forEach((b, i) => { b.mode = i === 0 ? "npc" : "off"; });
  misobons.forEach((m, i) => { m.mode = i === 0 ? "player" : "off"; }); // 動かさない(AIなし)
  startMatchLogic({ seed: 1 });
  const mb = misobons[0];
  mb.x = 0; mb.y = 0;
  destroyed.forEach(([x, y]) => { wallDamage[y][x] = 2; });
  bombermen[0].x = bmX; bombermen[0].y = bmY;
  return mb;
}

async function runUntil(cond, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    stepGame();
    if (cond()) return true;
    await sleep(16);
  }
  return cond();
}

test("動けない判定: 四隅でも周囲に歩けるマスがあれば動ける扱い。周囲が壊れて歩けず飛べない時だけ動けない", () => {
  const mb = setupCorner({ bmX: 7, bmY: 5, destroyed: [] });
  assert.equal(isMisobonImmobile(mb), false, "壁が無傷なら隣へ歩ける");
  wallDamage[0][1] = 2; wallDamage[1][0] = 2;
  assert.equal(isMisobonImmobile(mb), false, "隣が壊れても、2マス先へ飛べる(2マス先が無傷)");
  wallDamage[0][2] = 2; wallDamage[2][0] = 2;
  assert.equal(isMisobonImmobile(mb), true, "歩くのも飛ぶのも不可能");
  mb.jumpInProgress = true;
  assert.equal(isMisobonImmobile(mb), false, "ジャンプ中は対象にしない");
  resetMatch();
});

test("隅で動けないみそボンへ、撃てる位置にいるNPCボンバーマンがチャージショットを撃ち、飛び火で隅のマスを削る", async () => {
  const mb = setupCorner({ bmX: 1, bmY: 5 });         // 列 x=1 の真下から、壊れた壁 (1,0) の方へ撃てる
  assert.equal(wallDamage[0][0], 0);
  const hit = await runUntil(() => wallDamage[0][0] >= 1, 6000);
  assert.ok(hit, "隅のマスにダメージが入った(撃たなければ入らない)");
  // もう一発で倒れる
  const dead = await runUntil(() => !mb.alive, 8000);
  assert.ok(dead, "続けて撃って、みそボンを倒した");
  resetMatch();
});

test("撃てる位置が遠くても、NPCボンバーマンは撃てる位置まで歩いていって撃つ", async () => {
  const mb = setupCorner({ bmX: 11, bmY: 9 });        // 直線上ではない遠い位置
  const hit = await runUntil(() => wallDamage[0][0] >= 1, 12000);
  assert.ok(hit, "歩いて近づき、撃って、隅のマスにダメージが入った");
  assert.ok(mb.alive || wallDamage[0][0] >= 1);
  resetMatch();
});

test("動けるみそボンには、この狙いを使わない(従来どおりの挙動)", async () => {
  const mb = setupCorner({ bmX: 1, bmY: 5, destroyed: [] }); // 壁は無傷=動ける
  await runUntil(() => false, 1500);
  assert.equal(wallDamage[0][0], 0, "動けるみそボンの隅のマスは狙わない");
  assert.equal(isMisobonImmobile(mb), false);
  resetMatch();
});
