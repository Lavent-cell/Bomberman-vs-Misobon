import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {cardinalFromDelta,aimStepsFromDelta} from '../js/touchMath.js';
import {validateAction} from '../js/actions.js';
test('touch joystick is cardinal, has deadzone, rejects nonfinite values',()=>{
 assert.deepEqual(cardinalFromDelta(0,0),{dx:0,dy:0});
 assert.deepEqual(cardinalFromDelta(40,3),{dx:1,dy:0});
 assert.deepEqual(cardinalFromDelta(-30,5),{dx:-1,dy:0});
 assert.deepEqual(cardinalFromDelta(2,-40),{dx:0,dy:-1});
 assert.deepEqual(cardinalFromDelta(3,40),{dx:0,dy:1});
 assert.deepEqual(cardinalFromDelta(NaN,50),{dx:0,dy:0});
});
test('aim swipe step is signed, bounded integer',()=>{
 assert.equal(aimStepsFromDelta(24),0);
 assert.equal(aimStepsFromDelta(76),3);
 assert.equal(aimStepsFromDelta(-76),-3);
 assert.equal(aimStepsFromDelta(20000),30);
});
test('touch uses only existing validated server actions',()=>{
 for(const [action,params] of [['HOLD_DIR',{dx:0,dy:0}],['CHARGE_DIR',{dx:0,dy:-1}],['AIM_ADJUST',{dx:1,dy:0}],['JUMP',{dx:0,dy:1}],['CHARGE_START',{}],['CHARGE_RELEASE',{}],['AIM_START',{}],['AIM_RELEASE',{}]]){
 assert.equal(validateAction(action,params),true,action);
 }
 assert.equal(validateAction('JUMP',{dx:1,dy:1}),false);
});
test('mobile touch implementation includes cancel, release and spectator gates',()=>{
 const src=fs.readFileSync(new URL('../js/touchControls.js',import.meta.url),'utf8');
 assert.match(src,/pointercancel/);
 assert.match(src,/lostpointercapture/);
 assert.match(src,/visibilitychange/);
 assert.match(src,/netClient\.isSpectator\(\)/);
 assert.match(src,/CHARGE_CANCEL/);
 assert.match(src,/AIM_CANCEL/);
});
