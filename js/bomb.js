// js/bomb.js
import { clock } from "./clock.js";
import { bombs, bombermen, bombermanBlocked, game } from "./state.js";
import { map, isRing, rows, cols } from "./mapData.js";
import { registerWallHit, registerPillarHit, isPillarPassable, isActivePillar } from "./misobon.js";
import { killBomberman } from "./bomberman.js";
import { balance } from "./balance.js";
import { emitEvent } from "./events.js";

const DEFAULT_BLAST_KILL_MESSAGE = "爆風に巻き込まれた…ボンバーマンは行動不能になりました";
let nextBombId = 1;
export const BOMB_FUSE_MS = 1500;

export function checkBombermanBlastHit(cells, message = DEFAULT_BLAST_KILL_MESSAGE) {
  bombermen.forEach((bm) => {
    if (!bm.alive || bm.mode === "off") return;
    if (cells.some((cell) => cell.x === bm.x && cell.y === bm.y)) {
      killBomberman(bm, message);
    }
  });
}

export function placeBomb(bx, by, owner = null) {
  if (owner && owner.bombsActive >= balance.maxBombs) return;
  if (bombs.some((b) => b.x === bx && b.y === by)) return;

  if (owner) {
    owner.bombsActive += 1;
    owner.lastActionTime = clock.now();
    owner.stalled = false;
  }

  const bomb = { id: nextBombId++, x: bx, y: by, owner, explodeAt: clock.now() + BOMB_FUSE_MS };
  bombs.push(bomb);
  emitEvent("BOMB_PLACED", { bombId: bomb.id, x: bx, y: by, ownerId: owner?.id });

  bomb.timer = clock.setTimeout(() => {
    detonateBomb(bomb);
  }, BOMB_FUSE_MS);
}

function detonateBomb(bomb) {
  const idx = bombs.indexOf(bomb);
  if (idx === -1) return;

  clock.clearTimeout(bomb.timer);
  bombs.splice(idx, 1);

  explodeBlast(bomb.x, bomb.y);

  clock.setTimeout(() => {
    if (bomb.owner) {
      bomb.owner.bombsActive = Math.max(0, bomb.owner.bombsActive - 1);
    }
  }, 600);
}

function triggerChainExplosions(blastCells) {
  blastCells.forEach(({ x, y }) => {
    const hitBomb = bombs.find((b) => b.x === x && b.y === y);
    if (hitBomb) {
      detonateBomb(hitBomb);
    }
  });
}

export function explodeBlast(cx, cy, { visualClass = "", killMessage, range = 2, damagesWalls = true, stage = null, shockwaveSize = null } = {}) {
  const blastCells = [{ x: cx, y: cy }];

  const directions = [
    { dx: 0, dy: -1 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 0 },
    { dx: 1, dy: 0 }
  ];

  directions.forEach(({ dx, dy }) => {
    for (let dist = 1; dist <= range; dist++) {
      const blastX = cx + dx * dist;
      const blastY = cy + dy * dist;

      if (blastX < 0 || blastX >= cols || blastY < 0 || blastY >= rows) break;

      const isMapWall = map[blastY][blastX] === "0";
      const isBlockedWall = bombermanBlocked[blastY][blastX];

      if (isMapWall || isBlockedWall) {
        if (isActivePillar(blastX, blastY)) {
          if (isPillarPassable(blastX, blastY)) {
            blastCells.push({ x: blastX, y: blastY });
            continue;
          } else {
            if (damagesWalls) registerPillarHit(blastX, blastY);
            break;
          }
        } else {
          if (damagesWalls && isRing(blastX, blastY, game.misobonRingInset)) {
            registerWallHit(blastX, blastY);
          }
          break;
        }
      }

      blastCells.push({ x: blastX, y: blastY });
    }
  });

  // 描画側が各マスに炎を出せるよう、爆風が届いたマスをイベントに載せる
  emitEvent("EXPLOSION", { x: cx, y: cy, range, visualClass, stage, shockwaveSize, cells: blastCells.map((c) => ({ x: c.x, y: c.y })) });

  triggerChainExplosions(blastCells);
  checkBombermanBlastHit(blastCells, killMessage);

  return blastCells;
}
