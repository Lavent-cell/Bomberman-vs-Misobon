// nodeRunner.js
// 実行方法: node nodeRunner.js [--roster 2v2|3v5] [--matches N] [--seed S] [--stage 2|4] [--detail]
// Node.js環境下でロジックがDOM依存なしに完全動作するかを検証し、測定結果を出力する。
// 既定は台帳(benchmark-baseline.md)の基準条件(2対2・100試合・seed 20261012)。

import { runMeasurement } from "./js/measureMode.js";
import { balance, setSuddenDeathMaxStage } from "./js/balance.js";
import { bombermen, misobons } from "./js/state.js";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const roster = arg("roster", "2v2");
const matchCount = Number(arg("matches", 100));
const baseSeed = Number(arg("seed", 20261012));
const detail = process.argv.includes("--detail");
if (!setSuddenDeathMaxStage(Number(arg("stage", balance.suddenDeathMaxStage)))) {
  console.error("--stage は 2 か 4 を指定してください");
  process.exit(2);
}

if (roster === "2v2") {
  bombermen.forEach((b, i) => { b.mode = i < 2 ? "npc" : "off"; });
  misobons.forEach((m, i) => { m.mode = i < 2 ? "npc" : "off"; });
} else if (roster === "3v5") {
  bombermen.forEach((b) => { b.mode = "npc"; });
  misobons.forEach((m) => { m.mode = "npc"; });
} else {
  console.error(`--roster は 2v2 か 3v5 を指定してください (指定値: ${roster})`);
  process.exit(2);
}

const realLog = console.log;
console.log = () => {}; // runMeasurement 内部の整形ログを抑える(結果は下で1回だけ出す)

runMeasurement({
  matchCount,
  baseSeed,
  onProgress: () => {},
  onDone: (finalScores, report) => {
    console.log = realLog;
    if (!detail) delete report.matches;
    console.log(JSON.stringify({ roster, suddenDeathMaxStage: balance.suddenDeathMaxStage, scores: finalScores, report }, null, 2));
    process.exit(0);
  },
  onError: (err) => {
    console.log = realLog;
    console.error("エラー発生:", err);
    process.exit(1);
  }
});
