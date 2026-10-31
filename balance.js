// js/balance.js
export const balance = {
  laserMinAimMs: 650,
  laserCooldownMs: 4500,
  laserStepMs: 180,
  laserBlastRange: 1,

  maxBombs: 3, // ボンバーマンが同時に置ける爆弾の数。3個を正式な仕様とする(2026-10-22 Tsukiさん決定。当初案の2個から変更)
  crackedWallMoveMult: 1.8,
  chargeStage2SpreadRange: 2,
  matchTimeLimitMs: 150000,

  suddenDeathMaxStage: 2,
  measureMatchCount: 100
};

// サドンデスを止める段数(2か4)。試合開始前に選ぶ。既定は2。
export const SUDDEN_DEATH_STAGE_CHOICES = [2, 4];

export function setSuddenDeathMaxStage(n) {
  if (!SUDDEN_DEATH_STAGE_CHOICES.includes(n)) return false;
  balance.suddenDeathMaxStage = n;
  return true;
}
