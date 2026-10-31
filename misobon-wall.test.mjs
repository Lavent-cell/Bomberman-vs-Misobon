// みそボンの無敵化(壊れた壁の上に立ったまま死なない)の回帰テスト、と爆弾の同時設置数(3個)。
import test from "node:test";
import assert from "node:assert/strict";
import { bombermen, misobons, bombs, wallDamage } from "../js/state.js";
import { drainEvents } from "../js/events.js";
import { startMatchLogic } from "../js/matchStart.js";
import { resetMatch } from "../js/matchReset.js";
import { registerWallHit, handleLeavingCell, moveMisobon } from "../js/misobon.js";
import { placeBomb } from "../js/bomb.js";
import { balance } from "../js/balance.js";

function setup() {
  resetMatch(); drainEvents();
  bombermen.forEach((b, i) => { b.mode = i === 0 ? "npc" : "off"; });
  misobons.forEach((m, i) => { m.mode = i < 2 ? "npc" : "off"; });
  startMatchLogic({ seed: 1 });
  bombermen[0].x = 7; bombermen[0].y = 5; // 離れた場所
}

test("2体が重なったひび割れ壁: 片方が離れても壁は壊れず、残った側は次の1発で倒れる(無敵にならない)", () => {
  setup();
  const [a, b] = misobons;
  a.x = 0; a.y = 6; b.x = 0; b.y = 6;
  wallDamage[6][0] = 1;
  a.lastMoveTime = -1e9;
  moveMisobon(a, 0, 1);                            // a が離れる(下へ)
  assert.equal(a.y, 7, "a は実際に離れた");
  assert.equal(wallDamage[6][0], 1, "まだ b が立っている間は壊れない");
  assert.equal(b.alive, true);
  registerWallHit(0, 6);                           // 次の爆風
  assert.equal(wallDamage[6][0], 2);
  assert.equal(b.alive, false, "残った側も倒れる");
  resetMatch();
});

test("2体が重なったひび割れ壁に1発: 同じマスの全員が倒れる(先頭の1体だけではない)", () => {
  setup();
  const [a, b] = misobons;
  a.x = 14; a.y = 4; b.x = 14; b.y = 4;
  wallDamage[4][14] = 1;
  registerWallHit(14, 4);
  assert.equal(a.alive, false);
  assert.equal(b.alive, false);
  resetMatch();
});

test("すでに完全破壊の壁に立っているみそボン(万一そうなっても)は、当たれば倒れる", () => {
  setup();
  const a = misobons[0];
  a.x = 14; a.y = 7;
  wallDamage[7][14] = 2;
  registerWallHit(14, 7);
  assert.equal(a.alive, false, "壊れた壁の上では無敵にならない");
  resetMatch();
});

test("ひとりでひび割れ壁から離れると、従来どおりその壁は完全破壊になる", () => {
  setup();
  const a = misobons[0];
  a.x = 0; a.y = 6; wallDamage[6][0] = 1;
  handleLeavingCell(0, 6, a);
  assert.equal(wallDamage[6][0], 2);
  resetMatch();
});

test("爆弾の同時設置数は最大3個(正式仕様)。4個目は置けず、爆発して時間がたつと置ける", async () => {
  assert.equal(balance.maxBombs, 3);
  setup();
  const bm = bombermen[0];
  [[1, 1], [3, 1], [5, 1], [7, 1]].forEach(([x, y]) => { bm.x = x; bm.y = y; placeBomb(x, y, bm); });
  assert.equal(bombs.length, 3, "同時に置けるのは3個まで");
  assert.equal(bm.bombsActive, 3);
  const { sleep } = await import("./helpers.mjs");
  await sleep(2300); // 導火線1.5秒 + 後始末0.6秒
  assert.equal(bm.bombsActive, 0, "爆発後に枠が戻る");
  bm.x = 9; bm.y = 1; placeBomb(9, 1, bm);
  assert.equal(bombs.length, 1);
  resetMatch();
});
