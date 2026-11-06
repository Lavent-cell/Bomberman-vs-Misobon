// js/actions.js
import { bombermen, misobons, game } from "./state.js";
import { moveBomberman, bombermanPlaceBomb } from "./bomberman.js";
import { startBombermanCharge, releaseBombermanCharge, cancelBombermanCharge, registerChargeDirectionInput } from "./chargeShot.js";
import { moveMisobon, tryMisobonJump } from "./misobon.js";
import { startMisobonAim, releaseMisobonAim, cancelMisobonAim, adjustAimDistance, setMisobonAimDistance } from "./misobonLaser.js";

export function getCharacterByKey(charKeyId) {
  if (!charKeyId) return null;
  if (charKeyId.startsWith("b")) {
    return bombermen.find((b) => b.keyId === charKeyId) || null;
  }
  return misobons.find((m) => m.keyId === charKeyId) || null;
}

// 入力値の検証(ネット経由の不正値対策。ローカル入力は常に正しい値なので挙動は変わらない)
function isUnitDir(dx, dy, allowZero) {
  if (!Number.isInteger(dx) || !Number.isInteger(dy)) return false;
  if (Math.abs(dx) + Math.abs(dy) > 1) return false;
  return allowZero || dx !== 0 || dy !== 0;
}

const DIR_ACTIONS = new Set(["MOVE", "JUMP", "CHARGE_DIR", "AIM_ADJUST"]);

export function validateAction(action, params) {
  if (typeof action !== "string") return false;
  const p = params && typeof params === "object" ? params : {};
  if (DIR_ACTIONS.has(action)) return isUnitDir(p.dx, p.dy, false);
  if (action === "HOLD_DIR") return isUnitDir(p.dx, p.dy, true);
  if (action === "AIM_SET_DIST") return Number.isInteger(p.distance) && p.distance >= 0 && p.distance <= 50;
  return true;
}

export function dispatchAction(charKeyId, action, params = {}) {
  if (!game.gameStarted || game.over) return false;
  if (!validateAction(action, params)) return false;

  const char = getCharacterByKey(charKeyId);
  if (!char || !char.alive || char.mode === "off") return false;

  // 押しっぱなし方向(サーバーが毎ティック移動を繰り返す。0,0 で解除)
  if (action === "HOLD_DIR") {
    char.heldDir = params.dx === 0 && params.dy === 0 ? null : { dx: params.dx, dy: params.dy };
    if (char.heldDir && char.role === "bomberman") registerChargeDirectionInput(char, params.dx, params.dy);
    return true;
  }

  if (char.role === "bomberman") {
    switch (action) {
      case "MOVE":
        moveBomberman(char, params.dx, params.dy);
        return true;
      case "PLACE_BOMB":
        bombermanPlaceBomb(char);
        return true;
      case "CHARGE_START":
        startBombermanCharge(char);
        return true;
      case "CHARGE_RELEASE":
        releaseBombermanCharge(char);
        return true;
      case "CHARGE_CANCEL":
        cancelBombermanCharge(char);
        return true;
      case "CHARGE_DIR":
        registerChargeDirectionInput(char, params.dx, params.dy);
        return true;
    }
  } else if (char.role === "misobon") {
    switch (action) {
      case "MOVE":
        moveMisobon(char, params.dx, params.dy);
        return true;
      case "JUMP":
        tryMisobonJump(char, params.dx, params.dy);
        return true;
      case "AIM_START":
        startMisobonAim(char);
        return true;
      case "AIM_ADJUST":
        adjustAimDistance(char, params.dx, params.dy);
        return true;
      case "AIM_SET_DIST":
        setMisobonAimDistance(char, params.distance);
        return true;
      case "AIM_RELEASE":
        releaseMisobonAim(char);
        return true;
      case "AIM_CANCEL":
        cancelMisobonAim(char);
        return true;
    }
  }
  return false;
}
