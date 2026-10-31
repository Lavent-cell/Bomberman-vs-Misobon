// js/gameStart.js
import { clock } from "./clock.js";
import { game } from "./state.js";
import { netClient } from "./netClient.js";
import { setSuddenDeathMaxStage, SUDDEN_DEATH_STAGE_CHOICES } from "./balance.js";

const SD_STAGE_STORAGE_KEY = "bombervsmisobon_sd_stage";

function loadSdStage() {
  try {
    const v = Number(localStorage.getItem(SD_STAGE_STORAGE_KEY));
    return SUDDEN_DEATH_STAGE_CHOICES.includes(v) ? v : 2;
  } catch (e) {
    return 2;
  }
}

// サドンデスの停止段階(試合前に選ぶ)。ネット対戦中は部屋の主の選択をサーバーが決める
function setupRuleSelect() {
  if (!selSdStage) return;
  const saved = loadSdStage();
  setSuddenDeathMaxStage(saved);
  selSdStage.value = String(saved);
  selSdStage.addEventListener("change", () => {
    const n = Number(selSdStage.value);
    if (game.mirror) {
      netClient.send({ type: "SET_RULE", suddenDeathMaxStage: n });
      netClient.refreshLobbyUi(); // サーバーの値に戻す(確定は部屋の通知で反映される)
      return;
    }
    if (setSuddenDeathMaxStage(n)) {
      try { localStorage.setItem(SD_STAGE_STORAGE_KEY, String(n)); } catch (e) {}
    }
  });
}
import {
  startOverlay, btnGameStart, loadingMsgEl, countdownEl, statusEl, btnTop, btnAbort, selSdStage
} from "./dom.js";
import { updateTopControls } from "./render.js";
import { audioManager } from "./audio.js";
import { startSuddenDeathSchedule } from "./suddenDeath.js";
import { resetMatch } from "./matchReset.js";
import { startMatchTimer } from "./matchTimer.js";
import { setRngSeed } from "./random.js";

export function setupGameStart() {
  setupRuleSelect();
  // 「TOPへ」(ゲームセット後)と「中断してTOPへ」(試合中)。どちらも試合を初期状態に戻して開始画面を出す。
  // ネット対戦: 戻すのはサーバー(部屋の主だけ)。全員の画面が MATCH_RESET イベントで初期化される
  const returnToTop = (btn) => {
    btn.blur(); // スペースキー(チャージ)で再度押されないように
    if (game.mirror) {
      netClient.send({ type: "RETURN_TO_LOBBY" });
      return;
    }
    resetMatch();
  };
  btnTop.addEventListener("click", () => returnToTop(btnTop));
  if (btnAbort) btnAbort.addEventListener("click", () => returnToTop(btnAbort));

  btnGameStart.addEventListener("click", async () => {
    if (game.mirror) {
      // ネット対戦: BGMを読み込んでから、サーバーに開始を依頼する(開始は部屋の主だけが可能)
      btnGameStart.disabled = true;
      try { await audioManager.init(); } catch (err) { console.error(err); }
      netClient.send({ type: "START" });
      return;
    }
    btnGameStart.classList.add("hidden");
    loadingMsgEl.classList.remove("hidden");
    loadingMsgEl.textContent = "BGMを読み込み中...";

    try {
      await audioManager.init();
      loadingMsgEl.textContent = "準備完了!";
    } catch (err) {
      console.error(err);
      loadingMsgEl.textContent = "BGMの読み込みに失敗しました(音無しで続行します)";
    }

    runCountdown();
  });
}

function runCountdown() {
  countdownEl.classList.remove("hidden");
  let count = 3;
  countdownEl.textContent = String(count);

  const timer = clock.setInterval(() => {
    count -= 1;
    if (count > 0) {
      countdownEl.textContent = String(count);
    } else {
      clock.clearInterval(timer);
      countdownEl.textContent = "START!";

      setRngSeed(Date.now());
      audioManager.play();
      game.gameStarted = true;
      statusEl.textContent = "バトル開始!";

      startSuddenDeathSchedule();
      startMatchTimer();
      updateTopControls();

      clock.setTimeout(() => {
        startOverlay.classList.add("hidden");
        countdownEl.classList.add("hidden");
      }, 700);
    }
  }, 1000);
}
