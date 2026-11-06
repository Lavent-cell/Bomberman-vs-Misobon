// js/movementLoop.js
import { clock } from "./clock.js";
import { game, currentDirection, getActiveCharacter, bombermen, misobons } from "./state.js";
import { moveBomberman } from "./bomberman.js";
import { moveMisobon } from "./misobon.js";
import { updateAi } from "./ai.js";

export const TICK_MS = 16;

function applyHeldMove(c) {
  if (!c.heldDir || c.mode !== "player" || !c.alive) return;
  if (c.role === "bomberman") moveBomberman(c, c.heldDir.dx, c.heldDir.dy);
  else moveMisobon(c, c.heldDir.dx, c.heldDir.dy);
}

export function stepGame() {
  if (!game.gameStarted || game.over) return;

  // ネット対戦の端末は、サーバーの状態を映すだけ(NPCも移動も自前で進めない)
  if (game.mirror) return;

  updateAi();

  // 押しっぱなし方向を持つキャラ(サーバー上の人間プレイヤー)。ローカルでは heldDir は常に null
  for (const c of bombermen) applyHeldMove(c);
  for (const c of misobons) applyHeldMove(c);

  const char = getActiveCharacter();
  if (!char || char.mode !== "player" || !char.alive) return;

  if (currentDirection.dx === 0 && currentDirection.dy === 0) return;

  if (char.role === "bomberman") {
    moveBomberman(char, currentDirection.dx, currentDirection.dy);
  } else {
    moveMisobon(char, currentDirection.dx, currentDirection.dy);
  }
}

export function setupMovementLoop() {
  clock.setInterval(stepGame, TICK_MS, { keep: true });
}
