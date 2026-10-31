// js/dom.js
import { map, rows, cols, isPillar } from "./mapData.js";
import { bombermen, misobons, activeCharacterKey, setActiveCharacterKey, saveRosterSettings } from "./state.js";
import { renderAll } from "./render.js";

export const field = document.getElementById("field");
export const suddenDeathBanner = document.getElementById("sudden-death-banner");
export const statusEl = document.getElementById("status");

export const bmSlotsContainer = document.getElementById("bm-slots");
export const mbSlotsContainer = document.getElementById("mb-slots");

export const sliderMaster = document.getElementById("vol-master");
export const sliderBgm = document.getElementById("vol-bgm");
export const sliderSfx = document.getElementById("vol-sfx");
export const labelMaster = document.getElementById("vol-master-label");
export const labelBgm = document.getElementById("vol-bgm-label");
export const labelSfx = document.getElementById("vol-sfx-label");

export const startOverlay = document.getElementById("start-overlay");
export const btnGameStart = document.getElementById("btn-game-start");
export const loadingMsgEl = document.getElementById("loading-msg");
export const countdownEl = document.getElementById("countdown");
export const btnTop = document.getElementById("btn-top");
export const btnAbort = document.getElementById("btn-abort");
export const selSdStage = document.getElementById("sel-sd-stage");
export const matchTimerEl = document.getElementById("match-timer");

export const scoreNormalEl = document.getElementById("score-normal");
export const scoreMeasureEl = document.getElementById("score-measure");
export const btnResetNormal = document.getElementById("btn-reset-normal");
export const btnResetMeasure = document.getElementById("btn-reset-measure");

export const btnMeasureStart = document.getElementById("btn-measure-start");
export const measureProgressEl = document.getElementById("measure-progress");

// ネット対戦時に、枠の操作を差し替えるためのフック(netClient が設定する。未設定ならローカル動作)
export const uiHooks = {
  onSlotModeChange: null,   // (char, value) => 処理したら true
  onCardClick: null,        // (char) => 処理したら true
  slotSelectValue: null,    // (char) => 表示する値 or null
  slotSelectDisabled: null, // (char) => boolean
  topControls: null         // () => { abort, top } を返す(ネット対戦中のみ。ローカルなら null)
};

export const cellEls = [];
export const bombermanEls = [];
export const misobonEls = [];

export function buildGrid() {
  for (let y = 0; y < rows; y++) {
    const rowEls = [];
    for (let x = 0; x < cols; x++) {
      const ch = map[y][x];
      const cell = document.createElement("div");
      cell.className = "cell " + (ch === "0" ? "wall" : "floor") + (isPillar(x, y, 0) ? " pillar" : "");
      field.appendChild(cell);
      rowEls.push(cell);
    }
    cellEls.push(rowEls);
  }

  bombermen.forEach((bm) => {
    const el = document.createElement("div");
    el.className = `entity bomberman bm-${bm.id}`;
    el.style.setProperty("--char-color", bm.colorInfo.color);
    el.style.setProperty("--char-accent", bm.colorInfo.accent);
    el.style.setProperty("--char-visor", bm.colorInfo.visor);
    el.style.setProperty("--char-text", bm.colorInfo.text);
    el.innerHTML = `<div class="char-pom"></div><div class="char-visor"></div>`;
    field.appendChild(el);
    bombermanEls.push(el);
  });

  misobons.forEach((mb) => {
    const el = document.createElement("div");
    el.className = `entity misobon mb-${mb.id}`;
    el.style.setProperty("--char-color", mb.colorInfo.color);
    el.style.setProperty("--char-horn", mb.colorInfo.horn);
    el.style.setProperty("--char-eye", mb.colorInfo.eye);
    el.style.setProperty("--marker-color", mb.colorInfo.color);
    el.innerHTML = `<div class="char-horn-l"></div><div class="char-horn-r"></div><div class="char-eyes"><div class="char-eye"></div><div class="char-eye"></div></div><div class="laser-gauge"><div class="laser-gauge-fill"></div></div>`;
    field.appendChild(el);
    misobonEls.push(el);
  });

  buildSlotUi();
}

function buildSlotUi() {
  function createCard(char) {
    const card = document.createElement("div");
    card.className = "slot-card";
    card.id = `slot-${char.keyId}`;

    const icon = document.createElement("div");
    icon.className = "slot-icon-box";
    icon.style.background = char.colorInfo.color;
    icon.style.color = char.colorInfo.text || "#fff";
    icon.textContent = char.label;

    const info = document.createElement("div");
    info.className = "slot-info";

    const name = document.createElement("div");
    name.className = "slot-name";
    name.textContent = char.name;

    const select = document.createElement("select");
    select.className = "slot-select";
    select.innerHTML = `
      <option value="player">操作 (Player)</option>
      <option value="npc">NPC (CPU)</option>
      <option value="off">OFF (不参加)</option>
    `;
    select.value = char.mode;

    select.addEventListener("change", (e) => {
      e.stopPropagation();
      if (uiHooks.onSlotModeChange && uiHooks.onSlotModeChange(char, select.value)) {
        select.value = char.mode;
        return;
      }
      char.mode = select.value;
      if (char.mode === "player") {
        setActiveCharacterKey(char.keyId);
      }
      saveRosterSettings();
      renderAll();
    });

    card.addEventListener("click", () => {
      if (uiHooks.onCardClick && uiHooks.onCardClick(char)) return;
      if (char.mode !== "player") return;
      setActiveCharacterKey(char.keyId);
      renderAll();
    });

    info.appendChild(name);
    info.appendChild(select);
    card.appendChild(icon);
    card.appendChild(info);

    return card;
  }

  bmSlotsContainer.innerHTML = "";
  bombermen.forEach((bm) => bmSlotsContainer.appendChild(createCard(bm)));

  mbSlotsContainer.innerHTML = "";
  misobons.forEach((mb) => mbSlotsContainer.appendChild(createCard(mb)));
}
