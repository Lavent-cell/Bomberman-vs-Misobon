// Touch-only client input. All actions reuse the existing server-validated protocol.
import {game,getActiveCharacter,currentDirection} from "./state.js";
import {netClient} from "./netClient.js";
import {sendAction,setTouchDirection,releaseTouchDirection} from "./input.js";
import {getMisobonLaserDirection} from "./misobonLaser.js";
import {cardinalFromDelta,aimStepsFromDelta} from "./touchMath.js";

const zero={dx:0,dy:0};
const equal=(a,b)=>a.dx===b.dx&&a.dy===b.dy;
function playable(){
  if(!game.gameStarted||game.over) return false;
  if(game.mirror&&(!netClient.isConnected()||netClient.isSpectator())) return false;
  const char=getActiveCharacter();
  return !!char&&char.mode==="player"&&char.alive;
}
export function setupTouchControls(){
  if(!window.matchMedia?.("(pointer: coarse)").matches||!window.PointerEvent)return;
  const ui=document.getElementById("touch-controls");
  const pad=document.getElementById("touch-pad");
  const nub=document.getElementById("touch-pad-nub");
  const attack=document.getElementById("touch-attack");
  const jump=document.getElementById("touch-jump");
  if(!ui||!pad||!nub||!attack||!jump)return;
  let moving=null,attacking=null,jumping=null,attackChar=null,aimDir=zero,aimStep=0,lastAimSend=0,lastMoveDir={dx:0,dy:1};
  const halt=e=>{e.preventDefault();e.stopPropagation();};
  const capture=(el,e)=>{try{el.setPointerCapture(e.pointerId);}catch(_){}};
  function stopMove(){
    if(!moving)return;
    moving=null;nub.style.transform="translate(0px,0px)";pad.classList.remove("active");
    releaseTouchDirection();
  }
  function stopAttack(cancel=false){
    if(!attacking)return;
    attacking=null;attack.classList.remove("active");
    if(attackChar&&game.gameStarted&&!game.over){
      sendAction(attackChar.keyId,attackChar.role==="bomberman"?(cancel?"CHARGE_CANCEL":"CHARGE_RELEASE"):(cancel?"AIM_CANCEL":"AIM_RELEASE"));
    }
    attackChar=null;aimDir=zero;aimStep=0;
  }
  function stopJump(){jumping=null;jump.classList.remove("active");}
  function reset(){stopMove();stopAttack(true);stopJump();}
  function refresh(){
    const enabled=playable(),char=enabled?getActiveCharacter():null;
    ui.classList.toggle("visible",enabled);
    document.body.classList.toggle("touch-playing",enabled);
    jump.hidden=!char||char.role!=="misobon";
    attack.setAttribute("aria-label",char?.role==="misobon"?"レーザー：タップ・長押し・スライド":"爆弾：タップ・長押し・スライド");
    attack.querySelector(".touch-attack-label").textContent=char?.role==="misobon"?"レーザー":"爆弾";
    if(!enabled||(attackChar&&char?.keyId!==attackChar.keyId))reset();
    const w=window.innerWidth||800,h=window.innerHeight||600;
    const ratio=w>h?Math.min(1,(w-26)/480,(h-75)/416):Math.min(1,(w-14)/480);
    document.body.style.setProperty("--touch-field-scale",String(Math.max(.35,ratio)));
  }
  pad.addEventListener("pointerdown",e=>{
    if(moving||!playable())return;
    halt(e);capture(pad,e);
    moving={id:e.pointerId,x:e.clientX,y:e.clientY};
    pad.classList.add("active");
    nub.style.transform="translate(0px,0px)";
  });
  pad.addEventListener("pointermove",e=>{
    if(!moving||moving.id!==e.pointerId)return;
    halt(e);
    const dx=e.clientX-moving.x,dy=e.clientY-moving.y,len=Math.hypot(dx,dy)||1,r=Math.min(32,len);
    nub.style.transform="translate("+Math.round(dx/len*r)+"px,"+Math.round(dy/len*r)+"px)";
    const dir=cardinalFromDelta(dx,dy),char=getActiveCharacter();
    if(!char||!playable())return;
    if(dir.dx||dir.dy)lastMoveDir=dir;
    setTouchDirection(char,dir);
    // HOLD_DIR may set charge direction on server; restore explicit right-hand aim.
    if(attacking&&attackChar?.role==="bomberman"&&!equal(aimDir,zero)){
      sendAction(attackChar.keyId,"CHARGE_DIR",aimDir);
    }
  });
  for(const type of ["pointerup","pointercancel","lostpointercapture"]){
    pad.addEventListener(type,e=>{if(moving?.id===e.pointerId){halt(e);stopMove();}});
  }
  attack.addEventListener("pointerdown",e=>{
    if(attacking||!playable())return;
    halt(e);capture(attack,e);
    attackChar=getActiveCharacter();
    attacking={id:e.pointerId,x:e.clientX,y:e.clientY};
    aimDir=zero;aimStep=0;lastAimSend=0;
    attack.classList.add("active");
    sendAction(attackChar.keyId,attackChar.role==="bomberman"?"CHARGE_START":"AIM_START");
  });
  attack.addEventListener("pointermove",e=>{
    if(!attacking||attacking.id!==e.pointerId||!attackChar||!playable())return;
    halt(e);
    const dx=e.clientX-attacking.x,dy=e.clientY-attacking.y;
    if(attackChar.role==="bomberman"){
      const dir=cardinalFromDelta(dx,dy,17);
      if(!equal(dir,zero)&&!equal(dir,aimDir)){
        aimDir=dir;
        sendAction(attackChar.keyId,"CHARGE_DIR",dir);
      }
      return;
    }
    const laser=getMisobonLaserDirection(attackChar);
    if(!laser)return;
    const step=aimStepsFromDelta(laser.axis==="horizontal"?dx:dy);
    if(step===aimStep)return;
    const now=Date.now();
    if(now-lastAimSend<25)return;
    const diff=Math.max(-4,Math.min(4,step-aimStep));
    if(!diff)return;
    aimStep+=diff;lastAimSend=now;
    const dir=laser.axis==="horizontal"?{dx:Math.sign(diff),dy:0}:{dx:0,dy:Math.sign(diff)};
    for(let i=0;i<Math.abs(diff);i++)sendAction(attackChar.keyId,"AIM_ADJUST",dir);
  });
  attack.addEventListener("pointerup",e=>{if(attacking?.id===e.pointerId){halt(e);stopAttack(false);}});
  for(const type of ["pointercancel","lostpointercapture"]){
    attack.addEventListener(type,e=>{if(attacking?.id===e.pointerId){halt(e);stopAttack(true);}});
  }
  jump.addEventListener("pointerdown",e=>{
    if(jumping!==null||!playable())return;
    const char=getActiveCharacter();
    if(char?.role!=="misobon")return;
    halt(e);capture(jump,e);jumping=e.pointerId;
    jump.classList.add("active");
    const dir=(currentDirection.dx||currentDirection.dy)?currentDirection:lastMoveDir;
    sendAction(char.keyId,"JUMP",{dx:dir.dx,dy:dir.dy});
  });
  for(const type of ["pointerup","pointercancel","lostpointercapture"]){
    jump.addEventListener(type,e=>{if(jumping===e.pointerId){halt(e);stopJump();}});
  }
  window.addEventListener("blur",reset);
  document.addEventListener("visibilitychange",()=>{if(document.hidden)reset();});
  window.addEventListener("resize",refresh);
  window.addEventListener("orientationchange",refresh);
  window.setInterval(refresh,160);
  refresh();
}
