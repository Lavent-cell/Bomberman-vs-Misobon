// js/random.js
let currentSeed = 12345678;

export function setRngSeed(seed) {
  currentSeed = (seed >>> 0) || 1;
}

export function getRngSeed() {
  return currentSeed;
}

export function random() {
  currentSeed = (currentSeed + 0x6D2B79F5) | 0;
  let t = Math.imul(currentSeed ^ (currentSeed >>> 15), 1 | currentSeed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function shuffled(arr) {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = result[i];
    result[i] = result[j];
    result[j] = tmp;
  }
  return result;
}
