// Pure calculations shared by touch controls and tests.
export function cardinalFromDelta(dx,dy,deadZone=14) {
  if (!Number.isFinite(dx)||!Number.isFinite(dy)||dx*dx+dy*dy<deadZone*deadZone) return {dx:0,dy:0};
  return Math.abs(dx)>Math.abs(dy)?{dx:Math.sign(dx),dy:0}:{dx:0,dy:Math.sign(dy)};
}
export function aimStepsFromDelta(value,stepPx=25) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-30,Math.min(30,Math.trunc(value/stepPx)));
}
