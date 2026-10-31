// みそボンのレーザーと柱(実時計=サーバーと同じ環境)。
// 通常レーザー: 柱の手前のマスで止まって爆発し、柱を1段階進める。チャージレーザー: 柱を貫通し、通過した柱を1段階ずつ進める。
// (回帰: Node の時計の基準違いで、1フレーム目に飛行完了と判定され、途中のマスを調べず終点だけ判定していた)
import test from "node:test";
import assert from "node:assert/strict";
import { bombermen, misobons } from "../js/state.js";
import { drainEvents } from "../js/events.js";
import { startMisobonAim, releaseMisobonAim } from "../js/misobonLaser.js";
import { startMatchLogic } from "../js/matchStart.js";
import { resetMatch } from "../js/matchReset.js";
import { sleep } from "./helpers.mjs";

async function fire(holdMs) {
  resetMatch(); drainEvents();
  bombermen.forEach((b, i) => { b.mode = i === 0 ? "player" : "off"; });
  misobons.forEach((m, i) => { m.mode = i === 4 ? "player" : "off"; });
  startMatchLogic({ seed: 1 });
  const mb = misobons[4]; mb.x = 0; mb.y = 8;      // 左の壁。この行の x=2,4,6,8 に柱がある
  bombermen[0].x = 7; bombermen[0].y = 1;
  startMisobonAim(mb); mb.aimDistance = 8;
  await sleep(holdMs);
  const before = drainEvents().map((e) => e.type);
  releaseMisobonAim(mb);
  await sleep(2100);
  const after = drainEvents();
  resetMatch();
  return { before, after };
}

test("通常レーザー(単押し): チャージ表示イベントが出ず、最初の柱の手前で止まって、その柱だけ1段階進める", async () => {
  const { before, after } = await fire(700);
  assert.ok(!before.includes("AIM_CHARGED"));
  const laser = after.find((e) => e.type === "LASER_FIRE");
  assert.equal(laser.isCharged, false);
  const dmg = after.filter((e) => e.type === "PILLAR_DAMAGE").map((e) => `${e.x},${e.y}:${e.damage}`);
  assert.deepEqual(dmg, ["2,8:1"]);
  const ex = after.find((e) => e.type === "EXPLOSION");
  assert.deepEqual([ex.x, ex.y], [1, 8], "柱(2,8)の手前のマスで爆発");
  const end = after.find((e) => e.type === "LASER_END");
  assert.deepEqual([end.x, end.y], [1, 8], "画面のビームもそこで消える");
});

test("チャージレーザー(長押し): 柱を貫通し、通過した柱をそれぞれ1段階だけ進めて、終点で爆発する", async () => {
  const { before, after } = await fire(1800);
  assert.ok(before.includes("AIM_CHARGED"));
  assert.equal(after.find((e) => e.type === "LASER_FIRE").isCharged, true);
  const dmg = after.filter((e) => e.type === "PILLAR_DAMAGE").map((e) => `${e.x},${e.y}:${e.damage}`);
  assert.deepEqual(dmg, ["2,8:1", "4,8:1", "6,8:1", "8,8:1"]);
  const ex = after.find((e) => e.type === "EXPLOSION");
  assert.deepEqual([ex.x, ex.y], [8, 8]);
});

test("クールタイム: 撃った直後に LASER_COOLDOWN(残り時間つき)、明けると LASER_READY が出て、スナップショットに残り時間が載る", async () => {
  const { createSnapshot } = await import("../js/snapshot.js");
  const { balance } = await import("../js/balance.js");
  resetMatch(); drainEvents();
  bombermen.forEach((b, i) => { b.mode = i === 0 ? "player" : "off"; });
  misobons.forEach((m, i) => { m.mode = i === 4 ? "player" : "off"; });
  startMatchLogic({ seed: 1 });
  const mb = misobons[4]; mb.x = 0; mb.y = 8;
  bombermen[0].x = 7; bombermen[0].y = 1;
  const saved = balance.laserCooldownMs;
  balance.laserCooldownMs = 600; // テストを短くするため(試合の数値は戻す)
  try {
    startMisobonAim(mb); mb.aimDistance = 3;
    await sleep(700);
    drainEvents();
    releaseMisobonAim(mb);
    const fired = drainEvents();
    const cd = fired.find((e) => e.type === "LASER_COOLDOWN");
    assert.ok(cd && cd.charId === 4 && cd.durationMs === 600, "発射と同時にクールタイム開始を通知");
    const s = createSnapshot().misobons[4];
    assert.equal(s.laserCooldown, true);
    assert.ok(s.laserCooldownRemainingMs > 0 && s.laserCooldownRemainingMs <= 600 && s.laserCooldownTotalMs === 600);
    assert.ok(!fired.some((e) => e.type === "LASER_READY"));
    await sleep(750);
    assert.ok(drainEvents().some((e) => e.type === "LASER_READY" && e.charId === 4), "明けたら READY を通知");
    const s2 = createSnapshot().misobons[4];
    assert.equal(s2.laserCooldown, false);
    assert.equal(s2.laserCooldownRemainingMs, 0);
  } finally {
    balance.laserCooldownMs = saved;
    resetMatch();
  }
});
