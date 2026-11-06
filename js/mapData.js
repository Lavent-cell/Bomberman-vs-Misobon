// js/mapData.js
export const map = [
  "000000000000000",
  "011111111111110",
  "010101010101010",
  "011111111111110",
  "010101010101010",
  "011111111111110",
  "010101010101010",
  "011111111111110",
  "010101010101010",
  "011111111111110",
  "010101010101010",
  "011111111111110",
  "000000000000000"
];

export const rows = map.length;
export const cols = map[0].length;

export function isFloor(nx, ny) {
  return ny >= 0 && ny < rows && nx >= 0 && nx < cols && map[ny][nx] === "1";
}

export function isPillar(nx, ny, inset = 0) {
  if (nx <= 0 || nx >= cols - 1 || ny <= 0 || ny >= rows - 1) return false;
  if (map[ny][nx] !== "0") return false;
  const depth = Math.min(nx, ny, cols - 1 - nx, rows - 1 - ny);
  return depth > inset;
}

export function isRing(nx, ny, inset) {
  const minX = inset, maxX = cols - 1 - inset;
  const minY = inset, maxY = rows - 1 - inset;
  if (nx < minX || nx > maxX || ny < minY || ny > maxY) return false;
  return nx === minX || nx === maxX || ny === minY || ny === maxY;
}

export function clampToRing(x, y, inset) {
  const minX = inset, maxX = cols - 1 - inset;
  const minY = inset, maxY = rows - 1 - inset;
  return {
    x: Math.min(Math.max(x, minX), maxX),
    y: Math.min(Math.max(y, minY), maxY)
  };
}
