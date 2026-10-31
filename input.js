// js/input.js
import {
  game, currentDirection, pushOrUpdateDirectionKey, removeDirectionKey,
  getActiveCharacter, setActiveCharacterKey, bombermen, misobons
} from "./state.js";
import { dispatchAction } from "./actions.js";
import { isAimAxisKey } from "./misobonLaser.js";
import { renderAll } from "./render.js";
import { netClient } from "./netClient.js";

function directionFromKey(key) {
  if (key === "ArrowUp" || key === "w" || key === "W") return { dx: 0, dy: -1 };
  if (key === "ArrowDown" || key === "s" || key === "S") return { dx: 0, dy: 1 };
  if (key === "ArrowLeft" || key === "a" || key === "A") return { dx: -1, dy: 0 };
  if (key === "ArrowRight" || key === "d" || key === "D") return { dx: 1, dy: 0 };
  return null;
}

function isLaserKey(key) {
  return key === "f" || key === "F" || key === "b" || key === "B";
}

function cycleActiveCharacter() {
  const all = [...bombermen, ...misobons].filter((c) => c.alive && c.mode === "player");
  if (all.length <= 1) return;

  const current = getActiveCharacter();
  const idx = all.findIndex((c) => c.keyId === current.keyId);
  const next = all[(idx + 1) % all.length];
  setActiveCharacterKey(next.keyId);
  renderAll();
}

function selectCharacterByNumber(num) {
  if (num >= 1 && num <= 3) {
    const target = bombermen[num - 1];
    if (target && target.alive && target.mode === "player") {
      setActiveCharacterKey(target.keyId);
      renderAll();
    }
  } else if (num >= 4 && num <= 8) {
    const target = misobons[num - 4];
    if (target && target.alive && target.mode === "player") {
      setActiveCharacterKey(target.keyId);
      renderAll();
    }
  }
}

// ネット対戦中(game.mirror)は、入力をサーバーに送るだけ。ローカルのロジックには渡さない。
function sendAction(charKeyId, action, params = {}) {
  if (game.mirror) {
    if (netClient.isSpectator()) return; // 観戦者は操作しない
    if (netClient.isConnected()) netClient.sendAction(charKeyId, action, params);
    return;
  }
  dispatchAction(charKeyId, action, params);
}

// 押しっぱなしの方向をサーバーに伝える(変わったときだけ送る。サーバーが移動を繰り返す)
let lastSentHold = "0,0";
function syncHeldDirection(char) {
  if (!game.mirror) return;
  const key = `${currentDirection.dx},${currentDirection.dy}`;
  if (key === lastSentHold) return;
  lastSentHold = key;
  sendAction(char.keyId, "HOLD_DIR", { dx: currentDirection.dx, dy: currentDirection.dy });
}

export function setupInput() {
  window.addEventListener("keydown", (e) => {
    if (!game.gameStarted || game.over) return;

    if (e.key === "Tab") {
      e.preventDefault();
      if (!game.mirror) cycleActiveCharacter();
      return;
    }

    if (e.key >= "1" && e.key <= "8") {
      if (!game.mirror) selectCharacterByNumber(parseInt(e.key, 10));
      return;
    }

    const char = getActiveCharacter();
    if (!char || char.mode !== "player" || !char.alive) return;

    if (e.key === " ") {
      e.preventDefault();
      game.isSpacePressed = true;
      if (char.role === "bomberman") {
        if (!e.repeat) sendAction(char.keyId, "CHARGE_START");
      } else if (char.role === "misobon") {
        if (currentDirection.dx !== 0 || currentDirection.dy !== 0) {
          sendAction(char.keyId, "JUMP", { dx: currentDirection.dx, dy: currentDirection.dy });
        }
      }
      return;
    }

    if (isLaserKey(e.key)) {
      e.preventDefault();
      if (char.role === "misobon" && !e.repeat) {
        sendAction(char.keyId, "AIM_START");
      }
      return;
    }

    const dir = directionFromKey(e.key);
    if (!dir) return;

    if (char.role === "misobon" && char.laserAiming) {
      if (isAimAxisKey(char, dir.dx, dir.dy) && !e.repeat) {
        sendAction(char.keyId, "AIM_ADJUST", { dx: dir.dx, dy: dir.dy });
      }
      return;
    }

    pushOrUpdateDirectionKey(e.key, dir);

    if (game.mirror) {
      // サーバーが押しっぱなしの移動とチャージ方向を扱う
      syncHeldDirection(char);
      return;
    }

    if (char.role === "bomberman") {
      sendAction(char.keyId, "CHARGE_DIR", { dx: dir.dx, dy: dir.dy });
    }

    if (e.repeat) return;

    sendAction(char.keyId, "MOVE", { dx: dir.dx, dy: dir.dy });
  });

  window.addEventListener("keyup", (e) => {
    const char = getActiveCharacter();

    if (e.key === " ") {
      // ネット対戦中は、手元の charging 表示が遅れていても必ず離したことを伝える(短押しの取りこぼし防止)
      if (char && char.role === "bomberman" && (char.charging || game.mirror)) {
        sendAction(char.keyId, "CHARGE_RELEASE");
      }
      game.isSpacePressed = false;
      return;
    }

    if (isLaserKey(e.key)) {
      if (char && char.role === "misobon") {
        sendAction(char.keyId, "AIM_RELEASE");
      }
      return;
    }

    const dir = directionFromKey(e.key);
    if (!dir) return;
    removeDirectionKey(e.key);
    if (char) syncHeldDirection(char);
  });
}
