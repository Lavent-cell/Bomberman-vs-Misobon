// js/render.js
import { bombermen, misobons, activeCharacterKey, game, scores, bombs, wallDamage, pillarDamage, bombermanBlocked } from "./state.js";
import { bombermanEls, misobonEls, statusEl, suddenDeathBanner, btnTop, btnAbort, field, cellEls, uiHooks } from "./dom.js";
import { map, rows, cols, isPillar } from "./mapData.js";
import { renderScorePanel } from "./scoreUi.js";
import { addEventListener } from "./events.js";
import { clock } from "./clock.js";

const renderedBombEls = new Map();

export function renderBomberman(bm) {
  if (game.silentMode) return;
  const el = bombermanEls[bm.id];
  if (!el) return;

  el.style.left = `${bm.x * 32}px`;
  el.style.top = `${bm.y * 32}px`;
  el.classList.toggle("selected", activeCharacterKey === bm.keyId);
  el.classList.toggle("dead", !bm.alive);
  el.classList.toggle("off-duty", bm.mode === "off");
  // サーバーを映す端末は、チャージ中の表示もスナップショットから合わせる
  if (game.mirror) {
    el.classList.toggle("charging", !!bm.charging);
    el.classList.toggle("charge-ready", !!bm.charging && bm.chargeStage >= 1);
    el.classList.toggle("charge-stage-2", !!bm.charging && bm.chargeStage >= 2);
  }
}

export function renderMisobon(mb) {
  if (game.silentMode) return;
  const el = misobonEls[mb.id];
  if (!el) return;

  // ジャンプ演出中は、演出側が位置を動かすので上書きしない(ローカルも、ミラー端末も)
  const jumping = el.classList.contains("jumping") || (game.mirror && mb.jumpState);
  if (!jumping) {
    el.style.left = `${mb.x * 32}px`;
    el.style.top = `${mb.y * 32}px`;
  }
  el.classList.toggle("selected", activeCharacterKey === mb.keyId);
  el.classList.toggle("dead", !mb.alive);
  el.classList.toggle("off-duty", mb.mode === "off");
  // サーバーを映す端末は、照準中・チャージ完了の表示も状態から合わせる
  if (game.mirror) {
    el.classList.toggle("charging", !!mb.laserAiming);
    el.classList.toggle("charge-stage-2", !!mb.laserAiming && !!mb.laserCharged);
  }
}

// みそボンの照準マーカー(赤いL字)。状態(照準中・向き・距離)から描く。チャージ完了はピンク
const aimMarkerEls = new Map();

export function renderAimMarkers() {
  if (game.silentMode || !field) return;
  misobons.forEach((mb) => {
    const show = mb.alive && mb.mode !== "off" && mb.laserAiming && mb.aimAxis;
    let el = aimMarkerEls.get(mb.id);
    if (!show) {
      if (el) { el.remove(); aimMarkerEls.delete(mb.id); }
      return;
    }
    if (!el) {
      el = document.createElement("div");
      el.className = "misobon-aim-marker aim-marker";
      el.style.setProperty("--marker-color", mb.colorInfo.color);
      el.innerHTML = `
        <span class="corner corner-tl"></span>
        <span class="corner corner-tr"></span>
        <span class="corner corner-bl"></span>
        <span class="corner corner-br"></span>
      `;
      field.appendChild(el);
      aimMarkerEls.set(mb.id, el);
    }
    el.style.left = `${(mb.x + mb.aimDx * mb.aimDistance) * 32}px`;
    el.style.top = `${(mb.y + mb.aimDy * mb.aimDistance) * 32}px`;
  });
}

export function clearAimMarkers() {
  for (const el of aimMarkerEls.values()) el.remove();
  aimMarkerEls.clear();
}

// チャージ中のキャラの周りに、集まってくる粒子を出す(旧デザイン)。
// キャラの .charging / .charge-ready / .charge-stage-2 クラスに合わせて出し入れする
const chargeParticleEls = new Map();

export function syncChargeParticles() {
  if (game.silentMode || !field) return;
  const all = [...bombermanEls, ...misobonEls];
  all.forEach((el) => {
    let p = chargeParticleEls.get(el);
    if (!el.classList.contains("charging") || el.classList.contains("dead")) {
      if (p) { p.remove(); chargeParticleEls.delete(el); }
      return;
    }
    if (!p) {
      p = document.createElement("div");
      p.className = "charge-particles";
      const VARIANTS = ["variant-a", "variant-b", "variant-c"];
      const COUNT = 10;
      for (let k = 0; k < COUNT; k++) {
        const dot = document.createElement("div");
        dot.className = `charge-particle ${VARIANTS[k % VARIANTS.length]}`;
        dot.style.setProperty("--angle", `${(360 / COUNT) * k + Math.random() * 20}deg`);
        dot.style.setProperty("--dist", `${26 + Math.random() * 10}px`);
        dot.style.setProperty("--delay", `${Math.random() * 0.6}s`);
        p.appendChild(dot);
      }
      field.appendChild(p);
      chargeParticleEls.set(el, p);
    }
    p.style.left = el.style.left;
    p.style.top = el.style.top;
    p.classList.toggle("ready", el.classList.contains("charge-ready") || el.classList.contains("charge-stage-2"));
    p.classList.toggle("stage-2", el.classList.contains("charge-stage-2"));
  });
}

export function clearChargeParticles() {
  for (const p of chargeParticleEls.values()) p.remove();
  chargeParticleEls.clear();
}

// みそボンのレーザーのクールタイムゲージ(キャラの下)。
// 撃った瞬間に空になり、再び撃てるまで橙色で溜まる。溜まりきると青白く光り(一瞬フラッシュ)、「撃てる」状態になる。
// 溜まり具合はCSSの transition で動かす(毎フレーム描き直さない)。状態は laser-cooling クラスで持つ。
const laserGaugeState = new Map(); // charId -> { cooling, endsAt }

export function setLaserGauge(charId, cooling, remainingMs = 0, totalMs = 1) {
  if (game.silentMode) return;
  const el = misobonEls[charId];
  if (!el) return;
  const prev = laserGaugeState.get(charId);
  const fill = el.querySelector ? el.querySelector(".laser-gauge-fill") : null;

  if (cooling) {
    const endsAt = clock.now() + remainingMs;
    // スナップショットとイベントが同じクールタイムを二重に知らせても、ゲージを巻き戻さない
    if (prev && prev.cooling && Math.abs(prev.endsAt - endsAt) < 400) return;
    laserGaugeState.set(charId, { cooling: true, endsAt });
    el.classList.remove("laser-ready-flash");
    el.classList.add("laser-cooling");
    if (fill) {
      const done = Math.min(Math.max(1 - remainingMs / Math.max(totalMs, 1), 0), 1);
      fill.style.transition = "none";
      fill.style.transform = `scaleX(${done})`;
      void fill.offsetWidth; // 開始位置を確定させてから、満タンまで動かす
      fill.style.transition = `transform ${Math.max(remainingMs, 0)}ms linear`;
      fill.style.transform = "scaleX(1)";
    }
    return;
  }

  const wasCooling = !!(prev && prev.cooling);
  laserGaugeState.set(charId, { cooling: false, endsAt: 0 });
  el.classList.remove("laser-cooling");
  if (fill) {
    fill.style.transition = "none";
    fill.style.transform = "scaleX(1)";
  }
  if (wasCooling) {
    el.classList.remove("laser-ready-flash");
    void el.offsetWidth;
    el.classList.add("laser-ready-flash"); // 撃てるようになった瞬間のフラッシュ
  }
}

// 試合のリセットや死亡のときは、フラッシュなしで「満タン(待機)」の表示に戻す
export function resetLaserGauge(charId) {
  const el = misobonEls[charId];
  if (!el) return;
  laserGaugeState.set(charId, { cooling: false, endsAt: 0 });
  el.classList.remove("laser-cooling", "laser-ready-flash");
  const fill = el.querySelector ? el.querySelector(".laser-gauge-fill") : null;
  if (fill) {
    fill.style.transition = "none";
    fill.style.transform = "scaleX(1)";
  }
}

export function resetAllLaserGauges() {
  misobonEls.forEach((_, i) => resetLaserGauge(i));
}

function renderBombs() {
  if (game.silentMode || !field) return;
  const currentIds = new Set();

  bombs.forEach((b) => {
    currentIds.add(b.id);
    let el = renderedBombEls.get(b.id);
    if (!el) {
      el = document.createElement("div");
      el.className = "bomb";
      el.style.left = `${b.x * 32}px`;
      el.style.top = `${b.y * 32}px`;
      field.appendChild(el);
      renderedBombEls.set(b.id, el);
    }
  });

  for (const [id, el] of renderedBombEls) {
    if (!currentIds.has(id)) {
      el.remove();
      renderedBombEls.delete(id);
    }
  }
}

export function clearRenderedBombs() {
  for (const el of renderedBombEls.values()) el.remove();
  renderedBombEls.clear();
}

function updateSlotCards() {
  if (game.silentMode) return;
  [...bombermen, ...misobons].forEach((c) => {
    const card = document.getElementById(`slot-${c.keyId}`);
    if (!card) return;

    card.classList.toggle("active-control", activeCharacterKey === c.keyId && c.mode !== "off");
    card.classList.toggle("status-dead", !c.alive && c.mode !== "off");
    card.classList.toggle("status-off", c.mode === "off");

    const sel = card.querySelector(".slot-select");
    if (sel) {
      const want = (uiHooks.slotSelectValue && uiHooks.slotSelectValue(c)) || c.mode;
      if (sel.value !== want) sel.value = want;
      sel.disabled = !!(uiHooks.slotSelectDisabled && uiHooks.slotSelectDisabled(c));
    }
  });
}

function updateStatusSummary() {
  if (game.over || game.silentMode || !statusEl) return;
  const bmAlive = bombermen.filter((b) => b.alive && b.mode !== "off").length;
  const bmTotal = bombermen.filter((b) => b.mode !== "off").length;
  const mbAlive = misobons.filter((m) => m.alive && m.mode !== "off").length;
  const mbTotal = misobons.filter((m) => m.mode !== "off").length;
  statusEl.textContent = `ボンバーマン: ${bmAlive}/${bmTotal} 生存 | みそボン: ${mbAlive}/${mbTotal} 稼働`;
}

// 盤面(壁・ひび・サドンデスで埋まったマス)を、いまの状態から描き直す。変わったマスだけ書き換える。
export function renderBoard() {
  if (game.silentMode || cellEls.length === 0) return;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const cell = cellEls[y] && cellEls[y][x];
      if (!cell) continue;
      const isWall = map[y][x] === "0" || bombermanBlocked[y][x];
      let cls = "cell " + (isWall ? "wall" : "floor");
      // 柱(みそボンが入れない壁)はレンガ模様なし。サドンデスで外周に飲み込まれたマスは柱ではなくなる
      const activePillar = isWall && isPillar(x, y, game.misobonRingInset);
      if (activePillar) cls += " pillar";
      if (wallDamage[y][x] === 1) cls += " cracked";
      else if (wallDamage[y][x] === 2) cls += " wall-broken";
      // 柱の損傷表示は「いま柱であるマス」だけ。飲み込まれたマスに残っていると、
      // 壊れた柱(床色)の見た目のまま壁になって、透明に見えてしまう(みそボンが動ける壁と判別できない)
      if (activePillar) {
        if (pillarDamage[y][x] === 1) cls += " pillar-cracked";
        else if (pillarDamage[y][x] === 2) cls += " pillar-broken";
      }
      if (cell.className !== cls) cell.className = cls;
    }
  }
}

// 「中断してTOPへ」(試合中)と「TOPへ」(ゲームセット後)の表示を切り替える。
// ローカル: 試合中は中断、終了後はTOPへ。ネット対戦: 部屋の主だけに出す(戻す操作はサーバーが行う)。
export function updateTopControls() {
  if (game.silentMode) return;
  // 試合が始まったら body に match-live を付ける(開始前だけ出す「自キャラの矢印」を消す合図。見た目専用)
  if (typeof document !== "undefined" && document.body) {
    document.body.classList.toggle("match-live", !!game.gameStarted);
  }
  if (!btnTop || !btnAbort) return;
  let showAbort = game.gameStarted && !game.over;
  let showTop = game.over && game.matchMode === "normal";
  const net = uiHooks.topControls ? uiHooks.topControls() : null;
  if (net) { showAbort = !!net.abort; showTop = !!net.top; }
  btnAbort.classList.toggle("hidden", !showAbort);
  btnTop.classList.toggle("hidden", !showTop);
}

export function renderAll() {
  if (game.silentMode) return;
  bombermen.forEach((bm) => renderBomberman(bm));
  misobons.forEach((mb) => renderMisobon(mb));
  renderBombs();
  renderAimMarkers();
  syncChargeParticles();
  updateSlotCards();
  updateStatusSummary();
  updateTopControls();
}

addEventListener((event) => {
  if (event.type !== "GAME_OVER" || game.silentMode) return;
  const bucket = event.matchMode;
  const s = scores[bucket];

  if (statusEl) statusEl.textContent = `${event.resultText} ゲームセット!`;
  if (suddenDeathBanner) {
    suddenDeathBanner.textContent =
      `ゲームセット — 通算成績 ボンバーマン ${s.bomberman}勝 : ${s.misobon}勝 みそボン` +
      (s.draw > 0 ? ` (引き分け ${s.draw})` : "");
    suddenDeathBanner.classList.remove("warning");
  }

  renderScorePanel();
  updateTopControls();
});
