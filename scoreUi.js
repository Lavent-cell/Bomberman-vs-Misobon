// js/scoreUi.js
import { scores, resetScore } from "./state.js";
import {
  scoreNormalEl, scoreMeasureEl, btnResetNormal, btnResetMeasure,
  btnMeasureStart, measureProgressEl
} from "./dom.js";
import { runMeasurement } from "./measureMode.js";
import { balance } from "./balance.js";

function getPanels() {
  return {
    normal: { valueEl: scoreNormalEl, buttonEl: btnResetNormal, label: "通常対戦" },
    measure: { valueEl: scoreMeasureEl, buttonEl: btnResetMeasure, label: "測定モード" }
  };
}

function formatScore(s) {
  const total = s.bomberman + s.misobon + s.draw;
  const bmWinRate = total > 0 ? ((s.bomberman / total) * 100).toFixed(1) : "0.0";
  return `ボンバーマン ${s.bomberman}勝 (${bmWinRate}%) : ${s.misobon}勝 みそボン / 引き分け ${s.draw} (計${total}戦)`;
}

export function renderScorePanel() {
  const panels = getPanels();
  Object.keys(panels).forEach((bucket) => {
    if (panels[bucket].valueEl) {
      panels[bucket].valueEl.textContent = formatScore(scores[bucket]);
    }
  });
}

function confirmReset(label) {
  if (typeof window.confirm !== "function") return true;
  return window.confirm(`${label}の戦績をリセットします。よろしいですか?\n(もう一方の戦績には影響しません)`);
}

export function setupScorePanel() {
  const panels = getPanels();
  Object.keys(panels).forEach((bucket) => {
    const { buttonEl, label } = panels[bucket];
    if (buttonEl) {
      buttonEl.addEventListener("click", () => {
        if (!confirmReset(label)) return;
        resetScore(bucket);
        renderScorePanel();
      });
    }
  });

  if (btnMeasureStart) {
    btnMeasureStart.addEventListener("click", () => {
      btnMeasureStart.disabled = true;
      btnResetMeasure.disabled = true;
      measureProgressEl.textContent = "測定開始中...";

      runMeasurement({
        matchCount: balance.measureMatchCount || 100,
        onProgress: (current, total, currentScores, comp) => {
          const compText = comp ? ` (B${comp.bomberman} vs M${comp.misobon})` : "";
          measureProgressEl.textContent = `${current}/${total} 試合測定中...${compText}`;
          scoreMeasureEl.textContent = formatScore(currentScores);
        },
        onError: (message) => {
          btnMeasureStart.disabled = false;
          btnResetMeasure.disabled = false;
          measureProgressEl.textContent = message;
          setTimeout(() => { measureProgressEl.textContent = ""; }, 4000);
        },
        onDone: (finalScores) => {
          btnMeasureStart.disabled = false;
          btnResetMeasure.disabled = false;
          measureProgressEl.textContent = "測定完了!";
          scoreMeasureEl.textContent = formatScore(finalScores);
          setTimeout(() => { measureProgressEl.textContent = ""; }, 3000);
        }
      });
    });
  }

  renderScorePanel();
}
