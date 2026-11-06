// js/viewEvents.js
import { addEventListener } from "./events.js";
import {
  field, cellEls, bombermanEls, misobonEls, suddenDeathBanner, statusEl,
  matchTimerEl, startOverlay, btnGameStart, loadingMsgEl, countdownEl, btnTop, btnAbort
} from "./dom.js";
import { map, rows, cols, isPillar } from "./mapData.js";
import { clearRenderedBombs, renderAll, renderBoard, renderBomberman, renderMisobon, renderAimMarkers, clearAimMarkers, syncChargeParticles, clearChargeParticles, setLaserGauge, resetLaserGauge, resetAllLaserGauges } from "./render.js";
import { audioManager } from "./audio.js";
import { game, bombermen, misobons } from "./state.js";
import { clock } from "./clock.js";

const TRANSIENT_SELECTORS = [".bomb", ".explosion-circle", ".charge-shot", ".misobon-laser"].join(",");
const INITIAL_BANNER_TEXT = "サドンデス: 開始前";

function formatMatchTime(ms) {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(sec / 60);
  const s = String(sec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

// 旧 matchReset.js の画面側リセット(挙動は移設前と同一)
function resetMatchView(limitMs) {
  if (matchTimerEl) {
    matchTimerEl.textContent = `制限時間 ${formatMatchTime(limitMs)}`;
    matchTimerEl.classList.remove("warning");
  }
  if (!field) return;

  clearRenderedBombs();
  field.querySelectorAll(TRANSIENT_SELECTORS).forEach((el) => el.remove());
  clearAimMarkers();
  clearChargeParticles();
  resetAllLaserGauges();
  activeLaserBeams.clear();

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      cellEls[y][x].className = "cell " + (map[y][x] === "0" ? "wall" : "floor") + (isPillar(x, y, game.misobonRingInset) ? " pillar" : "");
    }
  }

  bombermanEls.forEach((el) => {
    el.classList.remove("charging", "charge-ready", "charge-stage-2", "dead");
  });
  misobonEls.forEach((el) => {
    el.classList.remove("jumping", "dead", "charging", "charge-stage-2");
    el.style.transition = "";
    el.style.transform = "";
  });

  audioManager.stop();

  suddenDeathBanner.textContent = INITIAL_BANNER_TEXT;
  suddenDeathBanner.classList.remove("warning");
  countdownEl.classList.add("hidden");
  countdownEl.textContent = "";
  loadingMsgEl.classList.add("hidden");
  loadingMsgEl.textContent = "";
  btnGameStart.classList.remove("hidden");
  startOverlay.classList.remove("hidden");
  btnTop.classList.add("hidden");
  if (btnAbort) btnAbort.classList.add("hidden");
  statusEl.textContent = "";

  renderAll();
}

// ロジックは状態を変えてイベントを出すだけなので、画面側がイベントを受けて描き直す。
// 状態が変わるイベント(移動・爆弾・爆発・死亡・サドンデス)ごとに、次のフレームで1回だけ全体を描き直す。
// (描き直しを予約するフレームは keep:true。試合終了時の clock.cancelAll() で消えて、予約が詰まらないように)
const activeLaserBeams = new Map(); // laserId -> { el, ended }
let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  clock.requestFrame(() => {
    renderQueued = false;
    renderAll();
  }, { keep: true });
}

// 動いたキャラだけは、すぐ(同じ瞬間に)描く
function renderMovedCharacter(event) {
  const list = event.charKeyId && event.charKeyId.startsWith("b") ? bombermen : misobons;
  const c = list.find((x) => x.keyId === event.charKeyId);
  if (!c) return;
  if (list === bombermen) renderBomberman(c);
  else renderMisobon(c);
}

function spawnExplosionCircle(cx, cy, size, visualClass = "") {
  if (game.silentMode) return;
  const circle = document.createElement("div");
  circle.className = `explosion-circle ${visualClass}`.trim();
  circle.style.width = `${size}px`;
  circle.style.height = `${size}px`;
  circle.style.left = `${cx - size / 2}px`;
  circle.style.top = `${cy - size / 2}px`;
  field.appendChild(circle);
  clock.setTimeout(() => circle.remove(), 600);
}

function spawnShockwave(cx, cy, stage, sizePx) {
  if (game.silentMode) return;
  const size = sizePx ?? (stage === 1 ? 96 : 160);
  const centerX = cx * 32 + 16;
  const centerY = cy * 32 + 16;
  const circle = document.createElement("div");
  circle.className = `explosion-circle charge-explosion charge-explosion-stage-${stage}`;
  circle.style.width = `${size}px`;
  circle.style.height = `${size}px`;
  circle.style.left = `${centerX - size / 2}px`;
  circle.style.top = `${centerY - size / 2}px`;
  field.appendChild(circle);
  clock.setTimeout(() => circle.remove(), 750);
}

export function setupViewEvents() {
  addEventListener((event) => {
    if (game.silentMode) return;

    switch (event.type) {
      case "MATCH_RESET":
        resetMatchView(event.limitMs);
        break;
      case "MATCH_TIMER": {
        if (!matchTimerEl) break;
        matchTimerEl.textContent = `制限時間 残り ${formatMatchTime(event.remainingMs)}`;
        matchTimerEl.classList.toggle("warning", event.remainingMs <= 30000);
        break;
      }
      case "MATCH_TIME_UP":
        if (matchTimerEl) matchTimerEl.textContent = "制限時間 終了";
        break;
      case "NET_COUNTDOWN": {
        startOverlay.classList.remove("hidden");
        btnGameStart.classList.add("hidden");
        loadingMsgEl.classList.add("hidden");
        countdownEl.classList.remove("hidden");
        countdownEl.textContent = String(event.count);
        break;
      }
      case "CHAR_MOVED":
        renderMovedCharacter(event);
        break;
      case "BOMB_PLACED":
        scheduleRender();
        break;
      case "MATCH_START": {
        scheduleRender();
        statusEl.textContent = "バトル開始!";
        countdownEl.classList.remove("hidden");
        countdownEl.textContent = "START!";
        try { audioManager.play(); } catch (e) { /* BGM未読み込みなら音なしで続行 */ }
        clock.setTimeout(() => {
          startOverlay.classList.add("hidden");
          countdownEl.classList.add("hidden");
        }, 700);
        break;
      }
      case "EXPLOSION": {
        scheduleRender();
        audioManager.playExplosionSfx();
        const cx = event.x * 32 + 16;
        const cy = event.y * 32 + 16;
        spawnExplosionCircle(cx, cy, 24, event.visualClass || "");
        // 爆風が届いた各マスに、小さい円(20px)を出す(旧デザイン)。中心(先頭)は上の24px
        if (Array.isArray(event.cells)) {
          for (const c of event.cells.slice(1)) {
            spawnExplosionCircle(c.x * 32 + 16, c.y * 32 + 16, 20, event.visualClass || "");
          }
        }
        if (event.stage) {
          spawnShockwave(event.x, event.y, event.stage, event.shockwaveSize);
        }
        break;
      }
      case "LASER_FIRE": {
        audioManager.playLaserSfx();
        if (misobonEls[event.charId]) misobonEls[event.charId].classList.remove("charging", "charge-stage-2");
        renderAimMarkers();
        const laserEl = document.createElement("div");
        laserEl.className = `misobon-laser ${event.axis}${event.isCharged ? " charge-laser" : ""}`;
        field.appendChild(laserEl);
        const startTime = clock.now() - (event.elapsedMs || 0);
        const beam = { el: laserEl, ended: false };
        if (event.laserId !== undefined) activeLaserBeams.set(event.laserId, beam);

        function step(now) {
          if (beam.ended) return;
          const t = Math.min((now - startTime) / event.durationMs, 1);
          const curX = event.startX + event.dx * event.targetDistance * t;
          const curY = event.startY + event.dy * event.targetDistance * t;
          laserEl.style.left = `${curX * 32}px`;
          laserEl.style.top = `${curY * 32}px`;
          if (t < 1) clock.requestFrame(step);
          else { laserEl.remove(); activeLaserBeams.delete(event.laserId); }
        }
        clock.requestFrame(step);
        break;
      }
      case "LASER_END": {
        // 柱・ボンバーマン・爆弾などで止まったレーザーは、止まった位置でビームを消す
        const beam = activeLaserBeams.get(event.laserId);
        if (beam) { beam.ended = true; beam.el.remove(); activeLaserBeams.delete(event.laserId); }
        break;
      }
      case "CHARGE_START": {
        const el = bombermanEls[event.charId];
        if (el) el.classList.add("charging");
        break;
      }
      case "CHARGE_STAGE": {
        // 段階が上がった瞬間(閾値はロジック側が持つ)。2段階目はピンクを混ぜた粒子
        const el = bombermanEls[event.charId];
        if (!el) break;
        el.classList.add("charging", "charge-ready");
        if (event.stage >= 2) el.classList.add("charge-stage-2");
        break;
      }
      case "AIM_START": {
        // 押し始めた瞬間からチャージ演出(青白い光+集まる粒子)を出す。キーが効いているか一目で分かるように。
        // チャージ完了(AIM_CHARGED)で2段階目(ピンク入り・速い粒子)に切り替わる。単押しは発射(LASER_FIRE)で消える
        const el = misobonEls[event.charId];
        if (el) el.classList.add("charging");
        renderAimMarkers();
        break;
      }
      case "AIM_CHARGED": {
        // みそボンのチャージ完了 = ボンバーマンの2段階目と同じ見た目
        const el = misobonEls[event.charId];
        if (el) el.classList.add("charging", "charge-stage-2");
        renderAimMarkers();
        break;
      }
      case "AIM_UPDATE":
        renderAimMarkers();
        break;
      case "AIM_CANCEL": {
        const el = misobonEls[event.charId];
        if (el) el.classList.remove("charging", "charge-stage-2");
        renderAimMarkers();
        break;
      }
      case "LASER_COOLDOWN":
        setLaserGauge(event.charId, true, event.durationMs, event.durationMs);
        break;
      case "LASER_READY":
        setLaserGauge(event.charId, false);
        break;
      case "CHAR_KILLED": {
        scheduleRender();
        if (event.role === "misobon") {
          resetLaserGauge(event.charId);
          const el = misobonEls[event.charId];
          if (el) el.classList.remove("charging", "charge-stage-2");
          renderAimMarkers();
        }
        break;
      }
      case "CHARGE_RELEASE":
      case "CHARGE_CANCEL": {
        const el = bombermanEls[event.charId];
        if (el) el.classList.remove("charging", "charge-ready", "charge-stage-2");
        break;
      }
      case "CHARGE_SHOT_FIRED": {
        const shotEl = document.createElement("div");
        shotEl.className = `charge-shot charge-shot-stage-${event.stage}`;
        field.appendChild(shotEl);
        const startTime = clock.now() - (event.elapsedMs || 0);

        function step(now) {
          const t = Math.min((now - startTime) / event.durationMs, 1);
          const curX = event.startX + (event.endX - event.startX) * t;
          const curY = event.startY + (event.endY - event.startY) * t;
          shotEl.style.left = `${curX * 32}px`;
          shotEl.style.top = `${curY * 32}px`;
          if (t < 1) clock.requestFrame(step);
          else shotEl.remove();
        }
        clock.requestFrame(step);
        break;
      }
      case "MISOBON_JUMP": {
        const el = misobonEls[event.charId];
        if (!el) break;
        el.style.transition = "none";
        el.classList.add("jumping");
        const startTime = clock.now() - (event.elapsedMs || 0);

        function step(now) {
          const t = Math.min((now - startTime) / event.durationMs, 1);
          const curX = event.fromX + (event.toX - event.fromX) * t;
          const curY = event.fromY + (event.toY - event.fromY) * t;
          const arc = 4 * t * (1 - t);
          el.style.left = `${curX * 32}px`;
          el.style.top = `${curY * 32 - 16 * arc}px`;
          el.style.transform = `translate(4px, 4px) scale(${1 + 0.15 * arc})`;
          if (t < 1) clock.requestFrame(step);
          else {
            el.style.transform = "";
            el.style.transition = "";
            el.classList.remove("jumping");
            scheduleRender();
          }
        }
        clock.requestFrame(step);
        break;
      }
      case "WALL_DAMAGE": {
        const cell = cellEls[event.y]?.[event.x];
        if (!cell) break;
        if (event.damage === 1) cell.classList.add("cracked");
        else if (event.damage === 2) {
          cell.classList.remove("cracked");
          cell.classList.add("wall-broken");
        }
        break;
      }
      case "PILLAR_DAMAGE": {
        const cell = cellEls[event.y]?.[event.x];
        if (!cell) break;
        if (event.damage === 1) cell.classList.add("pillar-cracked");
        else if (event.damage === 2) {
          cell.classList.remove("pillar-cracked");
          cell.classList.add("pillar-broken");
        }
        break;
      }
      case "SUDDEN_DEATH_STAGE": {
        renderBoard();
        scheduleRender(); // みそボンの強制移動・飲み込まれたボンバーマンも描く
        audioManager.playSuddenDeathAlarm();
        statusEl.textContent = `サドンデス第${event.stage}段階発動!`;
        suddenDeathBanner.classList.remove("warning");
        break;
      }
      case "SUDDEN_DEATH_COUNTDOWN": {
        suddenDeathBanner.textContent = `⚠ サドンデス第${event.nextStage}段階まで 残り${event.remainingSec}秒`;
        const isWarning = event.remainingSec <= 5;
        suddenDeathBanner.classList.toggle("warning", isWarning);
        if (isWarning) audioManager.playCountdownBeep(event.remainingSec);
        break;
      }
    }
    if (event.type !== "CHAR_MOVED") syncChargeParticles();
  });
}
