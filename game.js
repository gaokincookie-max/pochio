(()=>{'use strict';
const DATA=window.POCHO_DATA||{behaviorRules:[],roles:[]};
const M=window.Matter; if(!M){alert('Matter.js の読み込みに失敗しました。通信環境を確認してください。');return;}
const {Engine,Render,Runner,Bodies,Body,Composite,Constraint,Events}=M;
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const shell=$('#shell'), gameEl=$('#game'), scoreLayer=$('#score-layer'), gameStatus=$('#game-status');
const hudScore=$('#hud-score'), hudBest=$('#hud-best'), hudRemain=$('#hud-remaining'), nextCanvas=$('#next-preview');
const settingsModal=$('#settings-modal'), confirmModal=$('#confirm-modal'), confirmText=$('#confirm-text');
const MODES={short:{label:'SHORT',shots:15},middle:{label:'MIDDLE',shots:30},long:{label:'LONG',shots:50}};
const COLORS=[
 {id:'さくら',hex:'#f3a6b8'},{id:'みずいろ',hex:'#9fcfe5'},{id:'たまご',hex:'#f0d98f'},
 {id:'わかば',hex:'#a9d6ae'},{id:'ふじ',hex:'#b9a8da'},{id:'あんず',hex:'#eab18d'}];
const EXPRESSIONS=['ごきげん','ふつう','不機嫌'];
const DECOS=['なし','リボン','メガネ','王冠','芽'];
const DECO_RATE=[.85,.04,.04,.03,.04];
const RARITY_COLOR=['','#6f747d','#58a66b','#568cb9','#9a68bd','#d09a29','#fff7cf'];
const SAVE_KEY='pocho_save_v01';
const T={LOW:3.5,VERY_LOW:1.8,HIGH:8,VERY_HIGH:12,STILL:1.0,LONG:18,SHORT:2.8,RECENT:1.2,NEAR:110,POP_PROTECT:.4};
const PHYS={UP_FORCE:.00135,MAX_SPEED:18.5,MAX_ANG:.34,MAX_PULL:170,SLING:.112,PRELINK_STIFFNESS:.075,PRELINK_DAMPING:.09,DRAG_STIFFNESS:.19,DRAG_DAMPING:.045,PRELAUNCH_EDGE_DAMP:.38};
const LAUNCH_ZONE_TOP_RATIO=.66;
let save=loadSave();
let engine,render,runner,W=1,H=1,launchY=1,walls=[],topWall=null;
let initializingBoard=false,gameSessionId=0;
const INITIAL_POCHO_COUNT=7;
let state='menu',modeKey='middle',score=0,remaining=0,current=null,nextDesc=null,shotIndex=0,dragging=false,anchor={x:0,y:0};
let currentSet=null,nextSetDesc=null,grabbed=null,grabConstraint=null,pointerHistory=[];
let bodies=new Set(), bonds=new Set(), lastActivity=0, settleSince=0, paused=false, gameStartedAt=0;
let runStats=null, recentEvents=[], eventSerial=1;

function defaultSave(){return {saveVersion:1,best:{short:0,middle:0,long:0},plays:{short:0,middle:0,long:0},totals:{shots:0,contacts:0,sticks:0,pops:0,induced:0,score:0},roles:{}}}
function loadSave(){try{const s=JSON.parse(localStorage.getItem(SAVE_KEY)||'null');return Object.assign(defaultSave(),s||{}, {best:Object.assign(defaultSave().best,s?.best||{}),plays:Object.assign(defaultSave().plays,s?.plays||{}),totals:Object.assign(defaultSave().totals,s?.totals||{}),roles:s?.roles||{}})}catch{return defaultSave()}}
function persist(){try{localStorage.setItem(SAVE_KEY,JSON.stringify(save))}catch{}}
function showScreen(id){$$('.screen').forEach(x=>x.classList.remove('active'));$('#screen-'+id).classList.add('active');state=id;}
function menu(){stopGame();showScreen('menu');}

$$('[data-action="menu"]').forEach(b=>b.onclick=menu);
$('[data-action="open-mode"]').onclick=()=>showScreen('mode');
$('[data-action="open-book"]').onclick=()=>{renderBook();showScreen('book')};
$('[data-action="open-stats"]').onclick=()=>{renderStats();showScreen('stats')};
$$('[data-mode]').forEach(b=>b.onclick=()=>startGame(b.dataset.mode));
$('[data-action="replay"]').onclick=()=>startGame(modeKey);
$('#settings-btn').onclick=openSettings;
$$('[data-setting]').forEach(b=>b.onclick=()=>settingAction(b.dataset.setting));
$('#confirm-no').onclick=()=>{confirmModal.classList.add('hidden');settingsModal.classList.remove('hidden');};

function openSettings(){if(state!=='game')return;paused=true;runner.enabled=false;settingsModal.classList.remove('hidden')}
function settingAction(a){
 if(a==='continue'){settingsModal.classList.add('hidden');paused=false;runner.enabled=true;return}
 if(a==='retry') confirmAction('本当にゲームをリトライしますか？',()=>startGame(modeKey));
 if(a==='retire') confirmAction('本当にゲームをリタイアしますか？',()=>menu());
}
function confirmAction(text,fn){settingsModal.classList.add('hidden');confirmText.textContent=text;confirmModal.classList.remove('hidden');$('#confirm-yes').onclick=()=>{confirmModal.classList.add('hidden');fn()}}

function weightedChoice(items,weights){let r=Math.random()*weights.reduce((a,b)=>a+b,0);for(let i=0;i<items.length;i++){r-=weights[i];if(r<=0)return items[i]}return items.at(-1)}
function makeDescriptor(){
 const sizeRoll=Math.random(); const sizeClass=sizeRoll<.31?'小':sizeRoll<.75?'中':'大';
 const ranges={小:[19.2,25.2],中:[25.8,32.4],大:[33,40.8]}, rr=ranges[sizeClass];
 const color=COLORS[(Math.random()*COLORS.length)|0], expression=EXPRESSIONS[(Math.random()*3)|0], decoration=weightedChoice(DECOS,DECO_RATE);
 return {color:color.id,hex:color.hex,expression,decoration,sizeClass,radius:rand(rr[0],rr[1])};
}
function rand(a,b){return a+Math.random()*(b-a)}
function createPocho(desc,spawnType='shot'){
 const b=Bodies.circle(W*.5,launchY,desc.radius,{restitution:.72,friction:.014,frictionAir:.0045,density:.00155,slop:.03,collisionFilter:{category:1,mask:0},render:{fillStyle:desc.hex,strokeStyle:'#ffffff70',lineWidth:2}});
 const now=performance.now();
 b.pocho={id:'p'+eventSerial++, ...desc, spawnType, _initialExpression:desc.expression, launched:false,launchIndex:0,bornAt:now,lastUpdate:now,distance:0,maxSpeed:0,highSpeedSeen:false,wall:{left:0,right:0,top:0,bottom:0,last:null,lastAt:0,sequence:[]},contacts:new Map(),contactColors:[],colorsSeen:new Set(),expressionsSeen:new Set([desc.expression]),sizesSeen:new Set(),decorationsSeen:new Set(),contactCount:0,sameColorContacts:0,diffColorContacts:0,stickCount:0,detachCount:0,everStuck:false,expressionChanges:0,lastExpressionChange:0,lastContactAt:0,lastContactId:null,lastEvent:'spawn',lastEventAt:now,aloneSince:now,longStill:false,stillSince:0,groupsHistory:[],maxGroup:1,popWitnessed:0,lastPushedBy:null,lastPushAt:0,behaviorCandidateHits:0};
 Body.setStatic(b,true); return b;
}
function measure(){const r=gameEl.getBoundingClientRect();W=Math.max(280,r.width);H=Math.max(380,r.height);launchY=H*.82}
function setupPhysics(){
 measure();engine=Engine.create({positionIterations:10,velocityIterations:8,constraintIterations:5,enableSleeping:false});engine.gravity.x=0;engine.gravity.y=0;
 render=Render.create({element:gameEl,engine,options:{width:W,height:H,wireframes:false,background:'#eef0ed',pixelRatio:Math.min(devicePixelRatio||1,2)}});Render.run(render);runner=Runner.create();Runner.run(runner,engine);rebuildWalls();
 const c=render.canvas;c.addEventListener('pointerdown',pointerStart,{passive:false});c.addEventListener('pointermove',pointerMove,{passive:false});c.addEventListener('pointerup',pointerEnd,{passive:false});c.addEventListener('pointercancel',pointerEnd,{passive:false});
 Events.on(engine,'beforeUpdate',tick);Events.on(engine,'collisionStart',collisionStart);Events.on(engine,'collisionActive',collisionActive);Events.on(render,'afterRender',drawOverlay);
}
function teardownPhysics(){if(render){Render.stop(render);render.canvas.remove();render=null}if(runner){Runner.stop(runner);runner=null}engine=null;walls=[];topWall=null;bodies.clear();bonds.clear();current=null;currentSet=null;grabbed=null;grabConstraint=null;pointerHistory=[]}
function rebuildWalls(){
 if(!engine)return;if(walls.length)Composite.remove(engine.world,walls);
 const side={isStatic:true,restitution:.66,friction:.01,render:{visible:false}}, floor={isStatic:true,restitution:.3,friction:.02,render:{visible:false}}, top={isStatic:true,restitution:0,friction:.02,render:{visible:false}};
 topWall=Bodies.rectangle(W/2,-30,W+120,60,top);walls=[Bodies.rectangle(-30,H/2,60,H+120,side),Bodies.rectangle(W+30,H/2,60,H+120,side),topWall,Bodies.rectangle(W/2,H+30,W+120,60,floor)];Composite.add(engine.world,walls);
}
function startGame(m){
 stopGame();const session=++gameSessionId;modeKey=m;score=0;remaining=MODES[m].shots;shotIndex=0;lastActivity=performance.now();settleSince=0;gameStartedAt=performance.now();recentEvents=[];
 runStats={contacts:0,sticks:0,pops:0,induced:0,newRoles:new Set(),maxRarity:0,maxSingle:0,rolesTriggered:0,shots:0};
 showScreen('game');setupPhysics();nextSetDesc=makeSetDescriptor();nextDesc=null;updateHud();drawNext();
 initializeBoard(session);
}
function initialSlots(){
 const xs1=[.14,.38,.62,.86],xs2=[.25,.50,.75];
 return [...xs1.map((x,i)=>({x:W*x,y:42+(i%2)*3})),...xs2.map((x,i)=>({x:W*x,y:105+(i%2)*4}))];
}
function resetInitialHistory(b){
 const p=b.pocho,now=performance.now();p.bornAt=now;p.lastUpdate=now;p.distance=0;p.maxSpeed=0;p.highSpeedSeen=false;p.wall={left:0,right:0,top:0,bottom:0,last:null,lastAt:0,sequence:[]};p.contacts=new Map();p.contactColors=[];p.colorsSeen=new Set();p.expressionsSeen=new Set([p.expression]);p.sizesSeen=new Set();p.decorationsSeen=new Set();p.contactCount=0;p.sameColorContacts=0;p.diffColorContacts=0;p.stickCount=0;p.detachCount=0;p.everStuck=false;p.expressionChanges=0;p.lastExpressionChange=0;p.lastContactAt=0;p.lastContactId=null;p.lastEvent='initial';p.lastEventAt=now;p.aloneSince=now;p.longStill=false;p.stillSince=0;p.groupsHistory=[];p.maxGroup=1;p.popWitnessed=0;p.lastPushedBy=null;p.lastPushAt=0;p.behaviorCandidateHits=0;p.launchedAt=now;p.launchIndex=0;
}
function initializeBoard(session){
 initializingBoard=true;gameStatus.textContent='最初からいたぽちょが整列中…';
 const slots=initialSlots();
 for(let i=0;i<INITIAL_POCHO_COUNT;i++){
   const b=createPocho(makeDescriptor(),'initial'),slot=slots[i%slots.length];
   Body.setPosition(b,{x:slot.x+rand(-6,6),y:slot.y+rand(-3,3)});Body.setStatic(b,false);b.collisionFilter.mask=1;b.pocho.launched=true;b.pocho.launchedAt=performance.now();b.pocho.launchIndex=0;Composite.add(engine.world,b);bodies.add(b);
 }
 setTimeout(()=>{
   if(session!==gameSessionId||state!=='game'||!engine)return;
   for(const b of bodies){if(b.pocho?.spawnType==='initial'){Body.setVelocity(b,{x:0,y:0});Body.setAngularVelocity(b,0);resetInitialHistory(b)}}
   recentEvents=[];initializingBoard=false;lastActivity=performance.now();gameStartedAt=performance.now();spawnCurrent();updateHud();gameStatus.textContent='射出ゾーンで3ぽちょを振り回して、離してください';
 },900);
}
function stopGame(){gameSessionId++;persist();paused=false;initializingBoard=false;settingsModal.classList.add('hidden');confirmModal.classList.add('hidden');teardownPhysics()}
function makeSetDescriptor(){return [makeDescriptor(),makeDescriptor(),makeDescriptor()]}
function spawnCurrent(){
 if(remaining<=0)return;
 const descs=nextSetDesc||makeSetDescriptor();nextSetDesc=makeSetDescriptor();nextDesc=null;
 const cx=W*.5,cy=Math.max(H*LAUNCH_ZONE_TOP_RATIO+80,launchY);
 const maxR=Math.max(...descs.map(d=>d.radius));
 const offsets=[{x:0,y:-maxR*.65},{x:-maxR*.72,y:maxR*.58},{x:maxR*.72,y:maxR*.58}];
 const setId='set'+eventSerial++,setBodies=[];
 for(let i=0;i<3;i++){
   const b=createPocho(descs[i],'shot');
   b.pocho.launchSetId=setId;b.pocho.launchSetMember=i;b.pocho.launched=false;
   Body.setStatic(b,false);b.collisionFilter.mask=0;
   Body.setPosition(b,{x:cx+offsets[i].x,y:cy+offsets[i].y});
   Body.setVelocity(b,{x:0,y:0});Body.setAngularVelocity(b,0);
   Composite.add(engine.world,b);bodies.add(b);setBodies.push(b);
 }
 const links=[];
 for(const [i,j] of [[0,1],[1,2],[2,0]]){
   const a=setBodies[i],b=setBodies[j],rest=Math.max(14.4,a.pocho.radius+b.pocho.radius-8.4);
   const c=Constraint.create({bodyA:a,bodyB:b,length:rest,stiffness:PHYS.PRELINK_STIFFNESS,damping:PHYS.PRELINK_DAMPING,render:{visible:false}});
   c.preLaunchLink=true;Composite.add(engine.world,c);links.push(c);
 }
 currentSet={id:setId,bodies:setBodies,links,launched:false};current=setBodies[0];
 gameStatus.textContent='射出ゾーン内の好きなぽちょを掴んで振り回す';drawNext();
}
function updateHud(){hudScore.textContent=score.toLocaleString();hudRemain.textContent=remaining;hudBest.textContent='BEST '+(save.best[modeKey]||0).toLocaleString()}
function drawNext(){
 const ctx=nextCanvas.getContext('2d'),ds=nextSetDesc;ctx.clearRect(0,0,70,70);if(!ds)return;
 const spots=[[35,18],[22,43],[48,43]];
 for(let i=0;i<3;i++){const d=ds[i],r=Math.min(14.4,d.radius*.43);drawPocho2D(ctx,spots[i][0],spots[i][1],r,d,0)}
}
function point(e){const r=render.canvas.getBoundingClientRect();return{x:(e.clientX-r.left)*W/r.width,y:(e.clientY-r.top)*H/r.height}}
function hit(p,b){if(!b)return false;return Math.hypot(p.x-b.position.x,p.y-b.position.y)<=b.pocho.radius*1.5}
function launchZoneTop(){return H*LAUNCH_ZONE_TOP_RATIO}
function clampToLaunchZone(p,r=18){return{x:Math.max(r+4,Math.min(W-r-4,p.x)),y:Math.max(launchZoneTop()+r+4,Math.min(H-r-8,p.y))}}
function confinePrelaunchSet(){
 if(!currentSet||currentSet.launched)return;
 const zt=launchZoneTop();
 for(const b of currentSet.bodies){
  if(!b?.pocho)continue;
  const r=b.pocho.radius,pad=6,minX=r+pad,maxX=W-r-pad,minY=zt+r+pad,maxY=H-r-10;
  let x=b.position.x,y=b.position.y,vx=b.velocity.x,vy=b.velocity.y,hitX=false,hitY=false;
  if(x<minX){x=minX;hitX=true}else if(x>maxX){x=maxX;hitX=true}
  if(y<minY){y=minY;hitY=true}else if(y>maxY){y=maxY;hitY=true}
  if(hitX||hitY){
   Body.setPosition(b,{x,y});
   if(hitX)vx*=-PHYS.PRELAUNCH_EDGE_DAMP;
   if(hitY)vy*=-PHYS.PRELAUNCH_EDGE_DAMP;
   Body.setVelocity(b,{x:vx,y:vy});
   Body.setAngularVelocity(b,b.angularVelocity*.72);
  }
 }
}
function pointerStart(e){
 if(paused||!currentSet||currentSet.launched)return;const p=point(e);let target=null,best=Infinity;
 for(const b of currentSet.bodies){const d=Math.hypot(p.x-b.position.x,p.y-b.position.y);if(d<=b.pocho.radius*1.55&&d<best){target=b;best=d}}
 if(!target)return;
 dragging=true;grabbed=target;current=target;anchor={x:target.position.x,y:target.position.y};pointerHistory=[];
 const q=clampToLaunchZone(p,target.pocho.radius);pointerHistory.push({x:q.x,y:q.y,t:performance.now()});
 grabConstraint=Constraint.create({pointA:{x:q.x,y:q.y},bodyB:target,pointB:{x:0,y:0},length:0,stiffness:PHYS.DRAG_STIFFNESS,damping:PHYS.DRAG_DAMPING,render:{visible:false}});
 Composite.add(engine.world,grabConstraint);render.canvas.setPointerCapture?.(e.pointerId);gameStatus.textContent='振り回して、離す！';e.preventDefault();
}
function pointerMove(e){
 if(!dragging||!currentSet||!grabConstraint||!grabbed)return;const p=clampToLaunchZone(point(e),grabbed.pocho.radius);
 grabConstraint.pointA.x=p.x;grabConstraint.pointA.y=p.y;const now=performance.now();pointerHistory.push({x:p.x,y:p.y,t:now});
 while(pointerHistory.length>10||pointerHistory.length>2&&now-pointerHistory[0].t>180)pointerHistory.shift();e.preventDefault();
}
function pointerEnd(e){
 if(!dragging||!currentSet||currentSet.launched)return;dragging=false;
 const set=currentSet,now=performance.now();
 if(grabConstraint){Composite.remove(engine.world,grabConstraint);grabConstraint=null}
 // Pointer motion contributes a small release impulse so fast finger swings remain responsive on touch devices.
 let pv={x:0,y:0};if(pointerHistory.length>=2){const a=pointerHistory[0],z=pointerHistory.at(-1),dt=Math.max(16,z.t-a.t);pv={x:(z.x-a.x)/dt*16.67,y:(z.y-a.y)/dt*16.67}}
 const pm=Math.hypot(pv.x,pv.y);if(pm>PHYS.MAX_SPEED){pv.x*=PHYS.MAX_SPEED/pm;pv.y*=PHYS.MAX_SPEED/pm}
 for(const c of set.links)Composite.remove(engine.world,c);set.links=[];
 const launchNo=++shotIndex;
 for(const b of set.bodies){
   b.collisionFilter.mask=1;b.pocho.launched=true;b.pocho.launchedAt=now;b.pocho.launchIndex=launchNo;
   // Keep the physical swing velocity; only blend in finger velocity when Matter's body is lagging behind the pointer.
   const bv=speed(b),blend=b===grabbed?.55:.18;let vx=b.velocity.x+pv.x*blend,vy=b.velocity.y+pv.y*blend;
   const m=Math.hypot(vx,vy);if(m>PHYS.MAX_SPEED){vx*=PHYS.MAX_SPEED/m;vy*=PHYS.MAX_SPEED/m}Body.setVelocity(b,{x:vx,y:vy});
 }
 set.launched=true;remaining--;runStats.shots++;save.totals.shots++;lastActivity=now;updateHud();gameStatus.textContent='3ぽちょ解放・上重力 ON';
 currentSet=null;current=null;grabbed=null;pointerHistory=[];
 if(remaining>0)setTimeout(()=>{if(state==='game'&&!currentSet)spawnCurrent()},500);else gameStatus.textContent='最後の3ぽちょを見届けています';e.preventDefault();
}

function speed(b){return Math.hypot(b.velocity.x,b.velocity.y)}
function pairKey(a,b){return a.pocho.id<b.pocho.id?a.pocho.id+'|'+b.pocho.id:b.pocho.id+'|'+a.pocho.id}
function contactRec(a,b){let r=a.pocho.contacts.get(b.pocho.id);if(!r){r={count:0,lastAt:0,firstAt:0,everStuck:false,stickCount:0,detachCount:0,lastStickAt:0,lastStickExpression:null,maxSpeed:0};a.pocho.contacts.set(b.pocho.id,r)}return r}
function collisionContext(a,b,pair){
 const now=performance.now(),av=speed(a),bv=speed(b),rv=Math.hypot(a.velocity.x-b.velocity.x,a.velocity.y-b.velocity.y),dx=b.position.x-a.position.x,dy=b.position.y-a.position.y,dist=Math.max(1,Math.hypot(dx,dy));
 const relDot=((a.velocity.x-b.velocity.x)*dx+(a.velocity.y-b.velocity.y)*dy)/(Math.max(.01,rv)*dist); // + moving toward roughly
 const near=getNearby((a.position.x+b.position.x)/2,(a.position.y+b.position.y)/2,T.NEAR,[a,b]);
 return {id:eventSerial++,time:now,a,b,primary:a,other:b,x:(a.position.x+b.position.x)/2,y:(a.position.y+b.position.y)/2,av,bv,relativeSpeed:rv,headOn:Math.abs(relDot)>.62,shallow:Math.abs(relDot)<.34,near,nearCount:near.length,groupA:getGroup(a),groupB:getGroup(b),preColorsA:new Set(a.pocho.colorsSeen),preColorsB:new Set(b.pocho.colorsSeen),prevContactIdA:a.pocho.lastContactId,prevContactIdB:b.pocho.lastContactId,prevPushedByA:a.pocho.lastPushedBy,prevPushedByB:b.pocho.lastPushedBy,trigger:null,victims:[],causeType:'collision',pair};
}
function collisionStart(ev){if(state!=='game'||paused||initializingBoard)return;const now=performance.now();for(const pair of ev.pairs){const a=pair.bodyA,b=pair.bodyB;if(!a.pocho||!b.pocho||!a.pocho.launched||!b.pocho.launched)continue;if(isBonded(a,b))continue;if(a.pocho.launchSetId&&a.pocho.launchSetId===b.pocho.launchSetId&&now-Math.max(a.pocho.launchedAt||0,b.pocho.launchedAt||0)<450)continue;processContact(a,b,pair)}}
function processContact(a,b,pair){
 const ctx=collisionContext(a,b,pair),now=ctx.time;runStats.contacts++;save.totals.contacts++;lastActivity=now;
 for(const [self,other] of [[a,b],[b,a]]){const p=self.pocho,r=contactRec(self,other);r.count++;if(!r.firstAt)r.firstAt=now;r.lastAt=now;r.maxSpeed=Math.max(r.maxSpeed,ctx.relativeSpeed);p.contactCount++;p.lastContactAt=now;p.lastContactId=other.pocho.id;p.colorsSeen.add(other.pocho.color);p.expressionsSeen.add(other.pocho.expression);p.sizesSeen.add(other.pocho.sizeClass);if(other.pocho.decoration!=='なし')p.decorationsSeen.add(other.pocho.decoration);p.contactColors.push(other.pocho.color);if(p.contactColors.length>8)p.contactColors.shift();if(p.color===other.pocho.color)p.sameColorContacts++;else p.diffColorContacts++;p.lastEvent='contact';p.lastEventAt=now;p.aloneSince=now;}
 maybeExpressionChange(a,ctx);maybeExpressionChange(b,ctx);
 const outcome=evaluateBehavior(ctx);
 if(outcome==='POP'){ctx.trigger='弾ける';const origin=ctx.primary,culprit=origin===a?b:a;origin.pocho.lastPushedBy=culprit.pocho.id;origin.pocho.lastPushAt=now;popGroup(origin,ctx)}
 else if(outcome==='STICK'){ctx.trigger='くっつく';stick(a,b,ctx);scoreEvent(ctx);a.pocho.lastPushedBy=b.pocho.id;a.pocho.lastPushAt=now;b.pocho.lastPushedBy=a.pocho.id;b.pocho.lastPushAt=now}
 else{ctx.trigger='何も起こらない';scoreEvent(ctx);a.pocho.lastPushedBy=b.pocho.id;a.pocho.lastPushAt=now;b.pocho.lastPushedBy=a.pocho.id;b.pocho.lastPushAt=now}
 pushRecent({type:ctx.trigger,time:now,x:ctx.x,y:ctx.y,a:a.pocho.id,b:b.pocho.id});
}
function collisionActive(ev){for(const pair of ev.pairs){let b=null;if(pair.bodyA===topWall&&pair.bodyB?.pocho)b=pair.bodyB;else if(pair.bodyB===topWall&&pair.bodyA?.pocho)b=pair.bodyA;if(b){const p=b.pocho,now=performance.now();if(now-p.wall.lastAt>180){p.wall.top++;p.wall.last='top';p.wall.lastAt=now;p.wall.sequence.push('top');trimSeq(p.wall.sequence,8)}if(b.velocity.y<0||Math.abs(b.velocity.y)<2)Body.setVelocity(b,{x:b.velocity.x*.28,y:0});Body.setAngularVelocity(b,b.angularVelocity*.35)}}}
function wallChecks(){for(const b of bodies){if(!b.pocho?.launched)continue;const p=b.pocho,now=performance.now(),r=p.radius;if(b.position.x<r+4)wallHit(p,'left',now);if(b.position.x>W-r-4)wallHit(p,'right',now);if(b.position.y>H-r-4)wallHit(p,'bottom',now)}}
function wallHit(p,side,now){if(now-p.wall.lastAt<180&&p.wall.last===side)return;p.wall[side]++;p.wall.last=side;p.wall.lastAt=now;p.wall.sequence.push(side);trimSeq(p.wall.sequence,8)}
function trimSeq(a,n){if(a.length>n)a.splice(0,a.length-n)}
function maybeExpressionChange(b,ctx){const p=b.pocho,now=ctx.time;if(p.expressionChanges>=2||now-p.lastExpressionChange<9000)return;const age=(now-p.bornAt)/1000;const rare=(p.contactCount>=7&&age>12&&p.contactCount%7===0)||(p.detachCount>=1&&age>18&&p.contactCount%5===0);if(!rare)return;const i=EXPRESSIONS.indexOf(p.expression);p.expression=EXPRESSIONS[(i+1+(p.launchIndex%2))%3];p.expressionChanges++;p.lastExpressionChange=now;p.expressionsSeen.add(p.expression);p.lastEvent='expressionChange';p.lastEventAt=now;}

function evaluateBehavior(ctx){
 const ordered=['special','decoration','expression','color','size'];
 for(const layer of ordered){
   const rules=DATA.behaviorRules.filter(r=>r.active&&r.layer===layer);
   const results=[];
   for(const self of [ctx.a,ctx.b]){const other=self===ctx.a?ctx.b:ctx.a;for(const r of rules){if(!ruleAppliesAttribute(r,self))continue;if(r.result==='POP'&&performance.now()-(self.pocho.launchedAt||0)<T.POP_PROTECT*1000)continue;if(checkCondition(r.condition,ctx,self,other)){results.push(r)}}}
   if(results.length){const pop=results.find(r=>r.result==='POP'),chosen=pop||results[0];ctx.primary=choosePrimaryForRule(chosen,ctx);ctx.behaviorRule=chosen;ctx.primary.pocho.behaviorCandidateHits++;return chosen.result}
 }
 return 'NONE';
}
function ruleAppliesAttribute(r,self){const a=r.attribute,p=self.pocho;if(r.layer==='size')return a===p.sizeClass;if(r.layer==='color')return a===p.color;if(r.layer==='expression')return a===p.expression;if(r.layer==='decoration')return a===p.decoration;if(r.layer==='special')return a.split('×').every(x=>x===p.color||x===p.expression||x===p.decoration||x===p.sizeClass);return false}
function choosePrimaryForRule(r,ctx){if(ruleAppliesAttribute(r,ctx.a))return ctx.a;if(ruleAppliesAttribute(r,ctx.b))return ctx.b;return ctx.a}
function checkCondition(text,ctx,self,other){return String(text).split('＋').map(s=>s.trim()).every(c=>checkClause(c,ctx,self,other))}

function checkClause(c,ctx,self=ctx.primary||ctx.a,other=ctx.other||(self===ctx.a?ctx.b:ctx.a)){
 const p=self?.pocho,q=other?.pocho,now=ctx.time||performance.now();if(!p)return false;
 const rec=q?contactRec(self,other):null, age=(now-p.bornAt)/1000, sv=speed(self), ov=other?speed(other):0, rv=ctx.relativeSpeed??(other?Math.hypot(self.velocity.x-other.velocity.x,self.velocity.y-other.velocity.y):0);
 if(c.startsWith('弾け補正：相対速度')){const m=c.match(/([0-9]+(?:\.[0-9]+)?)以上/);return !!m&&rv>=Number(m[1]);}
 const g=getGroup(self), og=other?getGroup(other):[], all=ctx.victims?.length?ctx.victims:g, near=ctx.near||getNearby(ctx.x??self.position.x,ctx.y??self.position.y,T.NEAR,[self]);
 const colors=new Set(all.filter(x=>x.pocho).map(x=>x.pocho.color)), exprs=new Set(all.filter(x=>x.pocho).map(x=>x.pocho.expression)), sizes=new Set(all.filter(x=>x.pocho).map(x=>x.pocho.sizeClass)), decos=all.filter(x=>x.pocho&&x.pocho.decoration!=='なし').map(x=>x.pocho.decoration);
 // role/compound shorthands that need exact semantics
 if(c==='両方ごきげん')return q&&p.expression==='ごきげん'&&q.expression==='ごきげん';
 if(c==='両方不機嫌'||c==='不機嫌同士')return q&&p.expression==='不機嫌'&&q.expression==='不機嫌';
 if(c==='両方大'||c==='両方大サイズ'||c==='大サイズ同士')return q&&p.sizeClass==='大'&&q.sizeClass==='大';
 if(c==='両方装飾あり'||c==='両方装飾付き')return q&&p.decoration!=='なし'&&q.decoration!=='なし';
 if(c==='同装飾')return q&&p.decoration!=='なし'&&p.decoration===q.decoration;
 if(c==='同色ではない')return q&&p.color!==q.color;
 if(c==='同表情ではない')return q&&p.expression!==q.expression;
 if(c==='双方長時間生存'||c==='長時間同じ盤面に存在')return q&&age>=T.LONG&&((now-q.bornAt)/1000)>=T.LONG;
 if(c==='互いに一度も接触したことがない')return rec&&rec.count<=1;
 if(c==='全員高速ではない')return all.length>0&&all.every(x=>speed(x)<T.HIGH);
 if(c==='低速ぽちょが過半数'){const pool=near.length?near:all;return pool.length>0&&pool.filter(x=>speed(x)<=T.LOW).length>pool.length/2;}
 if(c==='壁3種類以上へ接触')return ['left','right','top','bottom'].filter(k=>p.wall[k]>0).length>=3;
 if(c==='左右壁接触済み')return p.wall.left>0&&p.wall.right>0;
 if(c==='起爆ぽちょが単独ではない')return (ctx.victims?.length||1)>1;
 if(c==='起爆ぽちょと誘爆ぽちょが異色')return (ctx.victims||[]).some(x=>x!==ctx.primary&&x.pocho.color!==ctx.primary?.pocho.color);
 if(c==='最後は誘爆ではなく自分が起爆')return ctx.trigger==='弾ける'&&self===ctx.primary;
 if(c==='装飾ありが含まれる')return decos.length>=1;
 if(c==='ごきげん・ふつう・不機嫌を全経験'||c==='3表情すべて経験済み')return p.expressionsSeen.size>=3;
 if(c==='3表情全て'||c==='3表情すべて含む')return exprs.size===3;
 if(c==='3サイズすべて含む')return sizes.size===3;
 if(c==='3体のうち2色以上')return (ctx.groupAfter?.length||0)>=3&&new Set(ctx.groupAfter.map(x=>x.pocho.color)).size>=2;
 if(c==='4体すべて異なる色')return (ctx.causeChain?.length||0)>=4&&new Set(ctx.causeChain.slice(-4).map(x=>x.pocho.color)).size===4;
 if(c==='AとDは直接接触していない')return (ctx.causeChain?.length||0)>=4&&!(ctx.causeChain[0].pocho.contacts.has(ctx.causeChain.at(-1).pocho.id));
 if(c==='他グループ2つ以上が至近距離'){const groups=[];const seen=new Set();for(const n of near){if(seen.has(n))continue;const gg=getGroup(n);gg.forEach(x=>seen.add(x));groups.push(gg)}return groups.length>=2;}
 if(c==='爆発によって密集が解消')return !!ctx.densityWillResolve;
 if(c==='加入者が単独だった')return !!ctx.newlyJoined&&((ctx.preGroupSize?.get(ctx.newlyJoined.pocho.id)||1)===1);
 if(c==='加入者が異色')return !!ctx.newlyJoined&&ctx.groupBefore?.some(x=>x.pocho.color!==ctx.newlyJoined.pocho.color);
 if(c==='初めて接着')return (ctx.prePairStickCount||0)===0;
 if(c==='3回目の再接着')return (ctx.prePairStickCount||0)===2;
 if(c==='同じ相手と過去2回接着')return (rec?.stickCount||0)>=2;
 if(c==='2回とも一度離れている')return (rec?.detachCount||0)>=2;
 if(c==='4体以上のグループ成立'||c==='一度の連続接着で4体グループ成立')return (ctx.groupAfter?.length||0)>=4;
 if(c==='誰も過去に接着経験なし')return ctx.preEverStuck&&[...ctx.preEverStuck.values()].every(v=>!v);
 if(c==='両方ともその後別グループ所属経験あり')return q&&p.maxGroup>=2&&q.maxGroup>=2&&p.detachCount>0&&q.detachCount>0;
 if(c==='離れている間に双方が別ぽちょへ接触')return q&&(rec?.detachCount||0)>0&&p.contacts.size>=2&&q.contacts.size>=2;
 if(c==='再会')return rec&&rec.count>=2;
 if(c==='一度離れて一定時間経過'||c==='一定時間以上離れていた')return (rec?.detachCount||0)>0&&now-(rec?.lastStickAt||0)>=3000;
 if(c==='接触時間が短い')return false; // collisionEnd計測未実装。該当役はinactive
 if(c==='自分もごきげん')return p.expression==='ごきげん';
 if(c==='互いに過去3回以上接触')return rec&&rec.count>=3;
 if(c==='他ぽちょへ接触'||c==='他ぽちょへ衝突')return !!q;
 if(c==='一度くっついて離れた履歴あり'||c==='一度くっついて離れた')return p.everStuck&&p.detachCount>0;
 if(c==='別グループに接触'||c==='別グループへ衝突'||c==='新しいグループへ接触')return q&&og.length>=2&&!g.includes(q);
 if(c==='初回衝突')return p.contactCount<=1;
 if(c==='直前に周囲で別のぽちょが弾けた')return recentEvents.some(e=>e.type==='弾ける'&&now-e.time<2000);
 if(c==='小さいあんず')return p.color==='あんず'&&p.sizeClass==='小';
 if(c==='接触地点の近くに他ぽちょが少ない')return near.length<=2;
 if(c==='過去に接触したことのない色'){const pre=self===ctx.a?ctx.preColorsA:ctx.preColorsB;return q&&!pre.has(q.color);}
 if(c==='自分の速度も低い')return sv<=T.LOW;
 if(c==='自分も移動中')return sv>T.STILL;
 if(c==='総接触回数が偶数')return p.contactCount>0&&p.contactCount%2===0;
 if(c==='自分が周辺最大サイズ'||c==='自分が周辺で最大サイズ')return near.every(x=>x.pocho.radius<=p.radius+.1);
 if(c==='外部ぽちょに衝突')return q&&!g.includes(other);
 if(c==='生存中に3色以上へ接触済み')return p.colorsSeen.size>=3;
 if(c==='今回が同色')return q&&p.color===q.color;
 if(c==='壁に2回以上当たっている')return wallTotal(p)>=2;
 if(c==='自分からぶつかる')return sv>ov+0.5;
 if(c==='接触地点付近に他ぽちょが2体以上')return near.length>=2;
 if(c==='1回の接触を起点')return !!q;
 if(c==='一度も接着なし')return !p.everStuck;
 if(c==='誘爆数3体以上')return Math.max(0,(ctx.victims?.length||1)-1)>=3;
 if(c==='4体全員が互いに未接触だった組み合わせを含む'){const gg=ctx.groupAfter||[];if(gg.length<4)return false;for(let i=0;i<gg.length;i++)for(let j=i+1;j<gg.length;j++){const rr=gg[i].pocho.contacts.get(gg[j].pocho.id);if(!rr||rr.count===0)return true;}return false;}
 if(c==='過去に複数回接触')return rec&&rec.count>=3;
 if(c==='離脱')return p.detachCount>0;
 if(c==='接着3回以上')return p.stickCount>=3;
 if(c==='装飾あり'){if(ctx.victims?.length)return ctx.victims.some(x=>x.pocho.decoration!=='なし');return p.decoration!=='なし';}
 // literal self attributes
 if(COLORS.some(x=>x.id===c))return p.color===c;if(EXPRESSIONS.includes(c))return p.expression===c;if(DECOS.includes(c))return p.decoration===c;if(['小','中','大'].includes(c))return p.sizeClass===c;
 if(c==='リボン付き')return p.decoration==='リボン';if(c==='メガネ付き')return p.decoration==='メガネ';if(c==='王冠付き')return p.decoration==='王冠';if(c==='芽付き')return p.decoration==='芽';
 if(c==='自分がごきげん')return p.expression==='ごきげん';if(c==='自分がふつう')return p.expression==='ふつう';if(c==='自分が不機嫌')return p.expression==='不機嫌';
 if(c==='自分が小'||c==='自分が小サイズ')return p.sizeClass==='小';if(c==='自分が大')return p.sizeClass==='大';
 // pair attributes
 if(c==='同色'||c==='相手が同色'||c==='同色相手'||c==='今回が同色接触')return q&&p.color===q.color;if(c==='異色'||c==='相手が異色'||c==='異色相手'||c==='異色接触'||c==='衝突相手が異色')return q&&p.color!==q.color;
 if(c==='異色相手へ高速接触'||c==='異色相手 ＋ 高速接触')return q&&p.color!==q.color&&rv>=T.HIGH;if(c==='低速で別相手に接触')return q&&rv<=T.LOW&&(p.lastContactId!==q.id||rec?.count<=1);if(c==='異色相手に接触')return q&&p.color!==q.color;
 if(c==='相手がさくら')return q?.color==='さくら';if(c==='相手もたまご')return q?.color==='たまご';
 if(c==='相手がごきげん'||c==='相手もごきげん')return q?.expression==='ごきげん';if(c==='相手がふつう'||c==='相手がふつう表情')return q?.expression==='ふつう';if(c==='相手が不機嫌'||c==='相手も不機嫌')return q?.expression==='不機嫌';
 if(c.includes('同じ表情')||c==='同表情'||c==='双方同表情')return q&&p.expression===q.expression;if(c.includes('異表情')||c.includes('表情が異なる'))return q&&p.expression!==q.expression;
 if(c==='ごきげんと不機嫌')return q&&new Set([p.expression,q.expression]).has('ごきげん')&&new Set([p.expression,q.expression]).has('不機嫌');
 if(c.includes('相手が大')||c==='相手も大'||c==='相手も大サイズ')return q?.sizeClass==='大';if(c.includes('相手が中以上'))return q&&q.sizeClass!=='小';if(c==='相手が中')return q?.sizeClass==='中';if(c==='相手が小')return q?.sizeClass==='小';if(c==='相手も小')return q?.sizeClass==='小';if(c==='相手も中')return q?.sizeClass==='中';
 if(c.includes('サイズ区分も同じ')||c==='同サイズ区分'||c==='サイズ区分同じ')return q&&p.sizeClass===q.sizeClass;
 if(c.includes('サイズが小と大'))return q&&new Set([p.sizeClass,q.sizeClass]).has('小')&&new Set([p.sizeClass,q.sizeClass]).has('大');
 const rd=q?Math.abs(p.radius-q.radius):0, ratio=q?Math.max(p.radius,q.radius)/Math.min(p.radius,q.radius):1;
 if(c.includes('サイズ差が非常に小')||c.includes('実サイズ差が非常に小'))return rd<=2.88;if(c.includes('サイズ差が小')||c.includes('サイズ差が一定以下')||c.includes('サイズが自分と近い'))return rd<=6;if(c.includes('サイズ差が大き')||c.includes('サイズ差がかなり大き'))return ratio>=1.38;
 if(c.includes('自分より大きい'))return q&&q.radius>p.radius+2.4;if(c.includes('自分より小さい')||c==='相手より小さい')return q&&q.radius<p.radius-2.4;if(c.includes('接触相手より自分が大きい'))return q&&p.radius>q.radius+2.4;if(c==='古い方が大きい')return q&&((p.launchIndex<q.launchIndex&&p.radius>q.radius)||(q.launchIndex<p.launchIndex&&q.radius>p.radius));
 // 速度語の意味を厳密化（LAB v0.4準拠）:
 // 「低速接触 / 高速衝突 / 接触速度 / 相対速度」は相対速度。
 // 「自分 / 相手 / 両方」と明記された場合のみ各Bodyの絶対速度。
 // 履歴を含む速度句は後段の専用判定へ回す。
 const historySpeed=/高速状態を経験済み|今回の速度が過去接触時より高い|前回より高い速度|今回だけ速度が急上昇|今回だけ高速|3回目だけ高速|その後初めての高速移動|変化後初めての高速衝突|他ぽちょに押されて高速化/;
 if(!historySpeed.test(c)){
   if(c.includes('大きい方がほぼ停止')){if(!q)return false;const big=p.radius>=q.radius?self:other;return speed(big)<T.STILL}
   if(c.includes('小さい方が非常に高速')){if(!q)return false;const small=p.radius<=q.radius?self:other;return speed(small)>=T.VERY_HIGH}
   if(c.includes('小さい方が高速')){if(!q)return false;const small=p.radius<=q.radius?self:other;return speed(small)>=T.HIGH}
   if(c.includes('両者とも高速移動中')||c.includes('両方とも高速')||c.includes('両方高速')||c.includes('双方高速'))return sv>=T.HIGH&&ov>=T.HIGH;
   if(c.includes('どちらも高速ではない')||c.includes('双方高速ではない'))return sv<T.HIGH&&ov<T.HIGH;
   if(c.includes('現在どちらも低速')||c.includes('どちらも低速')||c.includes('双方低速'))return sv<=T.LOW&&ov<=T.LOW;
   if(c.includes('自分の速度が低い')||c.includes('自分の速度も低い')||c.includes('自分が低速')||c==='現在は低速'||c==='現在低速')return sv<=T.LOW;
   if(c.includes('相手が停止に近い'))return ov<T.STILL;
   if(c.includes('相手が高速移動中')||c==='相手が高速'||c.includes('外部から高速衝突を受ける'))return ov>=T.HIGH;
   if(c.includes('自分が高速で衝突')||c.includes('高速で自分から衝突')||c.includes('接触直前の速度が高い')||c.includes('現在速度が一定以上')||c.includes('今回の速度が高い'))return sv>=T.HIGH;
   if(c.includes('かなり低速'))return rv<=T.VERY_LOW;
   if(c.includes('相対速度が低い')||c.includes('相対速度が一定以下')||c.includes('低速接触')||c.includes('低速で接触')||c.includes('接触速度が低い')||c==='低速'||c==='今回が低速'||c.includes('再接触時の速度が低い')||c.includes('今回の速度が低い'))return rv<=T.LOW;
   if(c.includes('相対速度が高い')||c.includes('相対速度が一定以上')||c.includes('接触速度が一定以上')||c.includes('高速衝突')||c.includes('高速接触')||c==='高速'||c==='今回が高速'||c.includes('高速で他ぽちょに接触')||c.includes('別の相手へ再度高速衝突'))return rv>=T.HIGH;
 }
 if(c.includes('接触速度が中程度'))return rv>T.LOW&&rv<T.HIGH;
 if(c.includes('正面'))return !!ctx.headOn;if(c.includes('接触角度が浅い'))return !!ctx.shallow;
 if(c.includes('停止')||c.includes('ほぼ停止')){if(c.includes('両者'))return sv<T.STILL&&ov<T.STILL;if(c.includes('相手'))return ov<T.STILL;return sv<T.STILL}
 if(c.includes('接触後の速度が急激に低下')||c.includes('接触後に両者の速度が低下'))return rv<T.HIGH;
 // position / surroundings
 if(c.includes('画面上半分')||c.includes('画面上部'))return (ctx.y??self.position.y)<H*.5;if(c.includes('天井付近'))return (ctx.y??self.position.y)<H*.22;if(c.includes('壁際'))return (ctx.x??self.position.x)<55||(ctx.x??self.position.x)>W-55;if(c.includes('壁際ではない'))return (ctx.x??self.position.x)>=55&&(ctx.x??self.position.x)<=W-55;
 if(c.includes('画面中央付近'))return Math.abs((ctx.x??self.position.x)-W/2)<W*.18&&Math.abs((ctx.y??self.position.y)-H/2)<H*.22;if(c.includes('画面の角付近'))return (((ctx.x??0)<70||(ctx.x??0)>W-70)&&((ctx.y??0)<90||(ctx.y??0)>H-90));
 let m;if((m=c.match(/近くに(?:他ぽちょが)?(\d+)体以上/))||(m=c.match(/周囲に(?:他ぽちょが)?(\d+)体以上/))||(m=c.match(/接触地点周辺に(\d+)体以上/))||(m=c.match(/接触地点の近くにぽちょが(\d+)体以上/))||(m=c.match(/接触地点周囲に(\d+)体以上/)))return near.length>=+m[1];
 if(c.includes('周囲に他ぽちょが少ない')||c.includes('周囲が密集していない'))return near.length<=2;if(c.includes('接触地点近くに他ぽちょが2体以下'))return near.length<=2;if(c.includes('接触地点周辺に複数のぽちょ'))return near.length>=2;if(c.includes('接触地点が密集地帯')||c.includes('周囲に他ぽちょが多い'))return near.length>=4;
 if((m=c.match(/周囲に(\d+)色以上/))||(m=c.match(/周囲に異色が(\d+)色以上/))){const s=new Set(near.map(x=>x.pocho.color));if(c.includes('異色'))s.delete(p.color);return s.size>=+m[1]}
 if(c.includes('周囲に同色が2体以上'))return near.filter(x=>x.pocho.color===p.color).length>=2;if(c.includes('周囲に自分と同色がいない'))return !near.some(x=>x.pocho.color===p.color);
 if(c.includes('周囲に同表情が2体以上'))return near.filter(x=>x.pocho.expression===p.expression).length>=2;if(c.includes('周囲のぽちょの表情が全てバラバラ'))return near.length>=2&&new Set(near.map(x=>x.pocho.expression)).size===near.length;
 // wall / motion history
 if(c.includes('壁に一度も触れていない')||c==='壁未接触')return wallTotal(p)===0;if(c.includes('壁接触経験あり'))return wallTotal(p)>0;if(c.includes('両方とも壁接触経験あり')||c.includes('両方壁接触済み'))return q&&wallTotal(p)>0&&wallTotal(q)>0;
 if(c.includes('天井接触済み')||c.includes('天井に一度触れている')||c.includes('天井接触経験あり'))return p.wall.top>0;if(c.includes('双方天井接触済み')||c.includes('相手も天井接触済み'))return q&&p.wall.top>0&&q.wall.top>0;
 if(c.includes('左右両壁に接触済み')||c.includes('左右両方の壁に触れた'))return p.wall.left>0&&p.wall.right>0;if(c.includes('全員左壁接触済み'))return all.length>0&&all.every(x=>x.pocho.wall.left>0);if(c.includes('全員右壁接触済み'))return all.length>0&&all.every(x=>x.pocho.wall.right>0);if(c.includes('全員天井接触済み'))return all.length>0&&all.every(x=>x.pocho.wall.top>0);
 if((m=c.match(/壁接触(?:回数)?が?(\d+)回以上/))||(m=c.match(/壁(\d+)回以上/)))return wallTotal(p)>=+m[1];if(c.includes('壁接触回数が少ない'))return wallTotal(p)<=2;if(c.includes('壁接触回数が偶数'))return wallTotal(p)>0&&wallTotal(p)%2===0;if(c.includes('壁接触回数が3の倍数'))return wallTotal(p)>0&&wallTotal(p)%3===0;
 if(c.includes('壁接触直後')||c.includes('壁反射直後')||c.includes('自分が壁接触直後'))return now-p.wall.lastAt<=T.RECENT*1000;if(c.includes('天井接触直後'))return p.wall.last==='top'&&now-p.wall.lastAt<=T.RECENT*1000;
 if(c.includes('左壁→右壁の順')){const s=p.wall.sequence;return s.length>=2&&s.at(-2)==='left'&&s.at(-1)==='right'}if(c.includes('同じ種類の壁に触れたことがある'))return q&&['left','right','top'].some(k=>p.wall[k]>0&&q.wall[k]>0);
 if(c.includes('累計移動距離が長い')||c.includes('射出後一定距離以上移動済み'))return p.distance>H*1.25;if(c.includes('高速状態を経験済み'))return p.highSpeedSeen;
 // time/history
 if(c.includes('生存時間が長い')||c.includes('長時間生存')||c.includes('生存時間が一定以上')||c.includes('生存時間一定以上'))return age>=T.LONG;if(c.includes('射出から短時間'))return age<=T.SHORT;if(c.includes('射出から一定時間経過'))return age>=8;
 if(c.includes('長時間単独'))return now-p.aloneSince>=9000;if(c.includes('長時間他ぽちょと接触していない')||c.includes('接触前に一定時間誰とも触れていない'))return now-p.lastContactAt>=6000;if(c.includes('長時間静止'))return p.longStill;
 if(c.includes('表情変化経験なし')||c.includes('表情変化なし'))return p.expressionChanges===0;if(c.includes('表情変化経験あり')||c.includes('過去に表情変化済み'))return p.expressionChanges>0;if(c.includes('表情変化2回以上'))return p.expressionChanges>=2;if(c.includes('3表情すべて経験'))return p.expressionsSeen.size>=3;
 if(c.includes('初期表情ふつう'))return p._initialExpression==='ふつう'||(p.expressionChanges===0&&p.expression==='ふつう');if(c.includes('現在表情ふつう'))return p.expression==='ふつう';
 if(c.includes('サイズが一度変化した履歴'))return false;
 // contact history
 if(c.includes('初対面')||c.includes('初接触')||c.includes('今まで接触なし')||c.includes('過去に接触なし'))return rec?rec.count<=1:true;
 if(c.includes('過去に一度以上接触済み')||c.includes('過去に接触済み')||c.includes('過去接触あり'))return rec&&rec.count>=2;
 if(c.includes('再接触'))return rec&&rec.count>=2;
 if((m=c.match(/同じ相手との(\d+)回目以上?の?接触/))||(m=c.match(/接触(\d+)回目以上/))||(m=c.match(/過去に(\d+)回以上接触/)))return rec&&rec.count>=+m[1];
 if((m=c.match(/同じ相手との(\d+)回目の接触/)))return rec&&rec.count===+m[1];
 if((m=c.match(/接触回数(\d+)回以上/))||(m=c.match(/総接触回数が(\d+)回以上/)))return p.contactCount>=+m[1];if(c.includes('接触回数2回以下'))return p.contactCount<=2;
 if((m=c.match(/同じ2体が過去(\d+)回以上接触/))||(m=c.match(/同じ相手と接触(\d+)回以上/)))return rec&&rec.count>=+m[1];if((m=c.match(/過去接触(\d+)回以上/)))return rec&&rec.count>=+m[1];
 if(c.includes('接触相手5体以上'))return p.contacts.size>=5;if(c.includes('3色以上と接触')||c.includes('過去に3種類以上の色と接触'))return p.colorsSeen.size>=3;if(c.includes('4色以上と接触'))return p.colorsSeen.size>=4;if(c.includes('全6色と接触')||c.includes('6色全てに接触')||c.includes('全基本色へ接触'))return p.colorsSeen.size>=6;
 if(c.includes('小中大すべてのサイズ区分と接触'))return p.sizesSeen.size>=3;if(c.includes('装飾4種すべてと接触'))return p.decorationsSeen.size>=4;
 if(c.includes('直近3回の接触相手がすべて異なる'))return p.contactColors.length>=3&&new Set(p.contactColors.slice(-3)).size===3;if(c.includes('直近の接触色が3種類すべて異なる'))return p.contactColors.length>=3&&new Set(p.contactColors.slice(-3)).size===3;
 if(c.includes('今回が4色目')||c.includes('4種類目へ接触'))return p.colorsSeen.size===4;if(c.includes('生存中にちょうど3種類の色と接触済み'))return p.colorsSeen.size===4; // current was just added
 if(c.includes('今まで未接触色')||c.includes('今回が未接触色'))return rec&&rec.count<=1;
 if(c.includes('同色接触回数より異色接触回数が多い'))return p.diffColorContacts>p.sameColorContacts;
 // launch order
 if(c.includes('奇数番目に射出'))return p.launchIndex%2===1;if(c.includes('相手が偶数番目'))return q&&q.launchIndex%2===0;if(c.includes('射出順が相手より後'))return q&&p.launchIndex>q.launchIndex;if(c.includes('射出順の差が偶数'))return q&&Math.abs(p.launchIndex-q.launchIndex)%2===0;if(c.includes('射出順が相手と3つ差'))return q&&Math.abs(p.launchIndex-q.launchIndex)===3;if(c.includes('5発以上前に射出'))return q&&Math.abs(p.launchIndex-q.launchIndex)>=5;
 // sticking / groups
 if(c.includes('現在単独')||c.includes('自分は単独')||c.includes('自分も単独状態')||c.includes('現在グループに属していない'))return g.length===1;if(c.includes('相手が単独'))return og.length===1;if(c.includes('双方単独')||c.includes('どちらも現在単独状態'))return g.length===1&&og.length===1;
 if(c.includes('一度もくっついていない')||c.includes('一度も接着していない')||c.includes('一度も接着経験なし')||c.includes('一度も接着したことがない'))return !p.everStuck;if(c.includes('一度くっついた')||c.includes('接着経験あり')||c.includes('過去接着経験あり'))return p.everStuck;
 if(c.includes('一度くっついた相手')||c.includes('過去に同じ相手と接着')||c.includes('同じ2体が過去に接着'))return rec?.everStuck;
 if(c.includes('一度離れ')||c.includes('離脱経験あり')||c.includes('その後離れた'))return p.detachCount>0||(rec?.detachCount>0);if(c.includes('現在は離れている'))return q&&!isBonded(self,other);
 if(c.includes('過去に同じグループだった'))return rec?.everStuck||p.groupsHistory.some(arr=>arr.includes(q?.id));
 if((m=c.match(/接着経験(\d+)回以上/)))return p.stickCount>=+m[1];if((m=c.match(/離脱(\d+)回以上/)))return p.detachCount>=+m[1];
 if(c.includes('相手が2体以上のグループ所属'))return og.length>=2;if(c.includes('相手がグループ所属'))return og.length>=2;if(c.includes('グループ人数4体以上'))return g.length>=4;if(c.includes('3体以上の接着グループになる')||c.includes('新しく3体グループが成立'))return ctx.groupAfter?.length>=3;if(c.includes('3体以上の既存グループへ加入'))return ctx.groupBefore?.length>=3;if(c.includes('既存4体以上グループへ加入'))return ctx.groupBefore?.length>=4;
 if(c.includes('接着グループ6体以上'))return all.length>=6;if(c.includes('接着グループ8体以上'))return all.length>=8;if(c.includes('起爆グループ3体以上'))return all.length>=3;if(c.includes('起爆グループ4体以上'))return all.length>=4;
 if(c.includes('グループ内に3色以上'))return colors.size>=3;if(c.includes('加入先に同色なし'))return ctx.groupBefore&&!ctx.groupBefore.some(x=>x.pocho.color===p.color);if(c.includes('加入先に同表情が1体以上'))return ctx.groupBefore?.some(x=>x.pocho.expression===p.expression);
 if(c.includes('自分がグループ内最大')||c.includes('自分がその中で最大')||c.includes('周辺で最大サイズ'))return all.every(x=>!x.pocho||x.pocho.radius<=p.radius+.1);
 if(c.includes('起爆ぽちょがグループ最古参'))return ctx.primary&&all.every(x=>x.pocho.launchIndex>=ctx.primary.pocho.launchIndex);if(c.includes('起爆ぽちょが最も壁接触回数が多い'))return ctx.primary&&all.every(x=>wallTotal(x.pocho)<=wallTotal(ctx.primary.pocho));
 // group composition roles
 if((m=c.match(/(?:グループ|誘爆内|起爆グループ|全体)で?(\d+)色以上/))||(m=c.match(/^(\d+)色以上$/)))return colors.size>=+m[1];if(c.includes('5色以上'))return colors.size>=5;if(c.includes('6色全て1体ずつ'))return all.length===6&&colors.size===6;
 if(c.includes('3表情すべて'))return exprs.size===3;if(c.includes('2表情以上'))return exprs.size>=2;if(c.includes('3表情中2種類以上'))return exprs.size>=2;if(c.includes('表情3種が2体ずつ'))return all.length===6&&EXPRESSIONS.every(e=>all.filter(x=>x.pocho.expression===e).length===2);
 if(c.includes('3サイズすべて'))return sizes.size===3;if(c.includes('サイズ区分2種類以上'))return sizes.size>=2;if(c.includes('小中大が2体ずつ'))return all.length===6&&['小','中','大'].every(s=>all.filter(x=>x.pocho.sizeClass===s).length===2);
 if(c.includes('装飾2種類以上'))return new Set(decos).size>=2;if(c.includes('装飾ありが1体以上')||c.includes('装飾ありを含む')||c.includes('装飾持ちを含む'))return decos.length>=1;if(c.includes('装飾ありが2体以上'))return decos.length>=2;if(c.includes('全員装飾なし'))return decos.length===0;if(c.includes('同じ装飾なし'))return new Set(decos).size===decos.length;
 // pop / induced
 if(c==='誘爆なし'||c==='今回誘爆なし')return (ctx.victims?.length||1)===1;if((m=c.match(/誘爆(\d+)体以上/)))return Math.max(0,(ctx.victims?.length||1)-1)>=+m[1];if(c.includes('誘爆あり'))return (ctx.victims?.length||1)>1;
 if(c.includes('誘爆込み4体以上'))return (ctx.victims?.length||0)>=4;if(c.includes('誘爆込み6体'))return (ctx.victims?.length||0)===6;if(c.includes('1回の起爆から5体以上消滅'))return (ctx.victims?.length||0)>=5;
 if(c.includes('起爆ぽちょが大サイズ'))return ctx.primary?.pocho.sizeClass==='大';if(c.includes('起爆ぽちょが小サイズ'))return ctx.primary?.pocho.sizeClass==='小';if(c.includes('起爆ぽちょがごきげん'))return ctx.primary?.pocho.expression==='ごきげん';if(c.includes('起爆ぽちょが天井接触済み'))return ctx.primary?.pocho.wall.top>0;if(c.includes('起爆ぽちょが装飾なし'))return ctx.primary?.pocho.decoration==='なし';if(c.includes('起爆ぽちょが不機嫌ではない'))return ctx.primary?.pocho.expression!=='不機嫌';
 if(c.includes('高速衝突が原因'))return ctx.relativeSpeed>=T.HIGH;if(c.includes('起爆原因が第三者から押された衝突')){const prev=ctx.primary===ctx.a?ctx.prevPushedByA:ctx.prevPushedByB;return !!prev&&prev!==other?.pocho.id;}
 if(c.includes('誘爆ぽちょに2色以上'))return new Set((ctx.victims||[]).filter(x=>x!==ctx.primary).map(x=>x.pocho.color)).size>=2;if(c.includes('起爆ぽちょと異表情が含まれる'))return (ctx.victims||[]).some(x=>x!==ctx.primary&&x.pocho.expression!==ctx.primary.pocho.expression);if(c.includes('起爆ぽちょと同色が誘爆にいない'))return !(ctx.victims||[]).some(x=>x!==ctx.primary&&x.pocho.color===ctx.primary.pocho.color);
 if(c.includes('誘爆内に3色以上'))return new Set((ctx.victims||[]).filter(x=>x!==ctx.primary).map(x=>x.pocho.color)).size>=3;
 if(c.includes('誘爆経験を目撃済み'))return p.popWitnessed>0;
 // event history / causality
 if(c.includes('直前3秒以内に別の接着イベント')||c.includes('その直前3秒以内に別の接着イベント'))return recentEvents.some(e=>e.type==='くっつく'&&now-e.time<3000);if(c.includes('さらに別の無反応イベント'))return recentEvents.some(e=>e.type==='何も起こらない'&&now-e.time<3000);if(c.includes('直近10秒以内に1000点以上獲得済み'))return recentEvents.filter(e=>e.type==='score'&&now-e.time<10000).reduce((s,e)=>s+(e.score||0),0)>=1000;
 if(c.includes('AがBを押す')||c.includes('BがCに衝突')||c.includes('CがDに接触')||c.includes('Dが起爆')||c.includes('因果経路5体以上')||c.includes('起点ぽちょと起爆ぽちょが別'))return (ctx.causeChain?.length||2)>= (c.includes('5体')?5:2);
 if(c.includes('起点と起爆は直接接触なし'))return (ctx.causeChain?.length||0)>=3;if(c.includes('途中で壁反射を1回以上挟む'))return (ctx.causeChain||[]).some(x=>x.pocho&&wallTotal(x.pocho)>0);if(c.includes('経路中4色以上'))return new Set((ctx.causeChain||[]).map(x=>x.pocho?.color)).size>=4;if(c.includes('経路中2表情以上'))return new Set((ctx.causeChain||[]).map(x=>x.pocho?.expression)).size>=2;if(c.includes('起点ぽちょはまだ生存'))return true;
 // deliberately difficult / metadata-ish clauses
 if(c.includes('互いに最も接触回数の多い相手'))return q&&maxContactPartner(p)===q.id&&maxContactPartner(q)===p.id;
 if(c.includes('一度もどちらも弾けていない'))return true;if(c.includes('どちらも弾けない')||c.includes('何も発生しない')||c.includes('それでも何も起こらない')||c.includes('それでも無反応')||c.includes('何も起きない')||c.includes('どの挙動条件にも該当しない'))return ctx.trigger==='何も起こらない';
 if(c.includes('一度も弾け条件未成立'))return p.behaviorCandidateHits===0;if(c.includes('起爆条件候補を過去に複数回満たした履歴'))return p.behaviorCandidateHits>=2;
 if(c.includes('前回')&&c.includes('表情'))return rec?.lastStickExpression?rec.lastStickExpression!==p.expression:false;
 if(c.includes('同じ装飾'))return q&&p.decoration!=='なし'&&p.decoration===q.decoration;if(c.includes('装飾種類が異なる'))return q&&p.decoration!=='なし'&&q.decoration!=='なし'&&p.decoration!==q.decoration;if(c.includes('相手も装飾あり'))return q&&q.decoration!=='なし';if(c.includes('相手もメガネなし'))return q&&q.decoration!=='メガネ';
 if(c.includes('全員異なる射出順区分'))return all.length>0; // launch indices themselves are unique
 if(c.includes('爆発によって密集が解消'))return (ctx.victims?.length||0)>=4;
 // rare reunion-history clauses: approximated from recorded group memberships
 if(c.includes('全員が過去に同じグループへ所属')||c.includes('過去に5体以上のグループだった')||c.includes('元グループと同じ構成メンバー')||c.includes('再び同じメンバーだけで接着'))return all.length>=4&&all.every(x=>x.pocho.groupsHistory.length>0);
 if(c.includes('その後全員一度離散')||c.includes('全員完全にバラバラ')||c.includes('一定時間以上離散'))return all.every(x=>x.pocho.detachCount>0);
 if(c.includes('離散後それぞれ別のぽちょへ接触'))return all.every(x=>x.pocho.contacts.size>=2);if(c.includes('再集合')||c.includes('再び接着'))return ctx.trigger==='くっつく';if(c.includes('最後の1体加入で成立'))return ctx.newlyJoined===self||!!ctx.newlyJoined;
 if(c.includes('接着順が前回と異なる'))return true;
 if(c.includes('そのうち誰も弾けていない'))return true;
 if(c.includes('接着後に双方とも不機嫌へ表情変化'))return p.expressionChanges>0&&q?.expressionChanges>0&&p.expression==='不機嫌'&&q.expression==='不機嫌';
 if(c.includes('それぞれ別グループ所属')||c.includes('双方そのグループからも離脱'))return p.maxGroup>=2&&q?.maxGroup>=2&&p.detachCount>0&&q.detachCount>0;
 if(c.includes('長時間経過'))return age>=T.LONG;
 if(c.includes('現在も双方不機嫌'))return q&&p.expression==='不機嫌'&&q.expression==='不機嫌';
 if(c.includes('起爆ぽちょが全員と直接または間接接着'))return all.length>=2;
 if(c.includes('起爆ぽちょが過去に所属したグループの他メンバーが全員既に消滅'))return p.groupsHistory.length>0&&p.detachCount>0;
 if(c.includes('起爆ぽちょは直前まで低速'))return sv<T.LOW;
 if(c.includes('衝突相手とは初対面'))return rec?.count<=1;
 if(c.includes('3体すべて異色'))return ctx.groupAfter?.length===3&&new Set(ctx.groupAfter.map(x=>x.pocho.color)).size===3;
 if(c.includes('表情が3種類すべて揃う'))return ctx.groupAfter?.length>=3&&new Set(ctx.groupAfter.map(x=>x.pocho.expression)).size===3;
 if(c.includes('サイズ区分も3種類すべて揃う'))return ctx.groupAfter?.length>=3&&new Set(ctx.groupAfter.map(x=>x.pocho.sizeClass)).size===3;
 if(c.includes('1秒以内')||c.includes('一定時間以内'))return true;
 if(c.includes('3体以上が順番に接着'))return recentEvents.filter(e=>e.type==='くっつく'&&now-e.time<1000).length>=2;
 if(c.includes('最終グループが3色以上'))return ctx.groupAfter&&new Set(ctx.groupAfter.map(x=>x.pocho.color)).size>=3;
 if(c.includes('自分だけ異表情'))return near.length>=2&&near.filter(x=>x.pocho.expression===p.expression).length===0;
 if(c.includes('相手は周囲の多数派表情')){if(!q)return false;const co={};near.forEach(x=>co[x.pocho.expression]=(co[x.pocho.expression]||0)+1);const max=Math.max(0,...Object.values(co));return (co[q.expression]||0)===max}
 if(c.includes('相手と同じ壁に触れた履歴がある'))return q&&['left','right','top','bottom'].some(k=>p.wall[k]>0&&q.wall[k]>0);
 if(c.includes('その後初接触'))return rec&&rec.count<=1;
 if(c.includes('相手の周囲に自分以外のふじがいる'))return q&&getNearby(other.position.x,other.position.y,T.NEAR,[self,other]).some(x=>x.pocho.color==='ふじ');
 if(c.includes('自分がグループの端')){let degree=0;for(const bond of bonds)if(bond.bodyA===self||bond.bodyB===self)degree++;return g.length>=2&&degree<=1;}
 if(c.includes('相手が装飾なし'))return q&&q.decoration==='なし';
 if(c.includes('相手が現在2体以上と接触中'))return og.length>=2;
 if(c.includes('接触相手が直前に別ぽちょと離れている'))return q&&q.lastEvent==='detach'&&now-q.lastEventAt<2500;
 if(c.includes('相手の表情が変化済み'))return q&&q.expressionChanges>0;
 if(c.includes('直前に別のぽちょへ触れていない')){const prev=self===ctx.a?ctx.prevContactIdA:ctx.prevContactIdB;return !prev||prev===q?.id;}
 if(c.includes('接着後に自分が多数派側へ入る'))return true;
 if(c.includes('過去2回とは違う位置帯'))return true;if(c.includes('現在表情が初回と異なる'))return p.expressionChanges>0;
 if(c.includes('一度も相互誘爆なし'))return true;
 if(c.includes('周囲に装飾付きが2体以上'))return near.filter(x=>x.pocho.decoration!=='なし').length>=2;if(c.includes('その中で自分だけ装飾あり'))return p.decoration!=='なし'&&near.every(x=>x.pocho.decoration==='なし');
 if(c.includes('グループ内に王冠なし'))return !og.some(x=>x.pocho.decoration==='王冠');if(c.includes('グループ内に芽付きなし'))return !og.some(x=>x.pocho.decoration==='芽');
 if(c.includes('一度グループの中心付近にいた')||c.includes('現在端にいる'))return p.everStuck;
 if(c.includes('過去に最大4体以上のグループへ所属'))return p.maxGroup>=4;
 if(c.includes('過去に3体以上を誘爆で見送っている'))return p.popWitnessed>=3;if(c.includes('自分は一度も誘爆されていない'))return true;
 if(c.includes('天井付近に一定時間滞在'))return p.wall.top>0&&age>T.LONG;
 if(c.includes('相手も長時間生存'))return q&&(now-q.bornAt)/1000>=T.LONG;
 if(c.includes('直前の接触で何も起きていない'))return p.lastEvent==='none';if(c.includes('直前イベントが「離れる」'))return p.lastEvent==='detach';
 if(c.includes('直前に別ぽちょへ衝突済み')||c.includes('直前の衝突から短時間以内'))return now-p.lastContactAt<1600;
 if(c.includes('その反動で今回の相手に接触')||c.includes('他ぽちょに押されて高速化')||c.includes('第三者へ衝突')){const prev=self===ctx.a?ctx.prevPushedByA:ctx.prevPushedByB;return prev&&prev!==q?.id&&now-p.lastPushAt<2000;}
 if(c.includes('下から高速で飛んできた相手'))return q&&q.velocity.y<0&&ov>=T.HIGH;
 if(c.includes('下方向へ動いている相手'))return q&&q.velocity.y>0;
 if(c.includes('接触時にほぼ同じ方向へ移動')){if(!other)return false;const dot=self.velocity.x*other.velocity.x+self.velocity.y*other.velocity.y;return dot>0}
 if(c.includes('今度は別相手')||c.includes('今回が別相手')||c.includes('別の相手'))return p.lastContactId!==q?.id||rec?.count<=1;
 if(c.includes('直前の接触相手と別の色'))return p.contactColors.length>=2&&p.contactColors.at(-2)!==q?.color;
 if(c.includes('今回の速度が過去接触時より高い')||c.includes('前回より高い速度'))return rec&&rv>=rec.maxSpeed*.9;
 if(c.includes('今度が過去接触済み相手')||c.includes('今回が過去接触済み相手'))return rec&&rec.count>=2;
 if(c.includes('今回が同じ相手との3回目以上'))return rec&&rec.count>=3;
 if(c.includes('同じ相手と連続3回衝突'))return rec&&rec.count>=3&&p.lastContactId===q?.id;
 if(c.includes('3回目だけ高速'))return rec&&rec.count>=3&&rv>=T.HIGH;
 if(c.includes('直近の接触色が「異色→異色→自色」')){const a=p.contactColors;if(a.length<3)return false;return a.at(-3)!==p.color&&a.at(-2)!==p.color&&a.at(-1)===p.color}
 if(c.includes('今回も自色'))return q&&q.color===p.color;
 if(c.includes('今回がそのどれかと同色'))return p.contactColors.slice(-4,-1).includes(q?.color);
 if(c.includes('今回の相手が初対面'))return rec&&rec.count<=1;
 if(c.includes('同色への接触が今回で2回目'))return p.sameColorContacts===2;
 if(c.includes('接触回数が一定以上')||c.includes('総接触回数が多い'))return p.contactCount>=6;
 if(c.includes('壁接触回数が一定以上'))return wallTotal(p)>=4;
 if(c.includes('過去の接触回数が多い')||c.includes('過去に何度も接触済み'))return rec&&rec.count>=4;
 if(c.includes('相手と連続接触中'))return rec&&now-rec.lastAt<600;
 if(c.includes('今回だけ速度が急上昇')||c.includes('今回だけ高速'))return rv>=T.HIGH;
 if(c.includes('同じ相手と短時間に')||c.includes('短時間に複数回'))return rec&&rec.count>=3&&now-rec.firstAt<6000;
 if(c.includes('長時間接着していた履歴'))return rec?.lastStickAt&&now-rec.lastStickAt>6000;
 if(c.includes('その後誰とも接触していない'))return now-p.lastContactAt<100; // evaluated during first new contact
 if(c.includes('変化後初めての接触')||c.includes('変化後初めての高速衝突'))return p.expressionChanges>0&&now-p.lastExpressionChange<4000;
 if(c.includes('変化後一定時間経過'))return p.expressionChanges>0&&now-p.lastExpressionChange>5000;
 if(c.includes('一度も弾け条件未成立'))return p.behaviorCandidateHits===0;
 return false;
}
function wallTotal(p){return p.wall.left+p.wall.right+p.wall.top+p.wall.bottom}
function maxContactPartner(p){let id=null,n=-1;for(const [k,v] of p.contacts)if(v.count>n){n=v.count;id=k}return id}

function stick(a,b,ctx){
 if(isBonded(a,b))return;ctx.preEverStuck=new Map([...new Set([...ctx.groupA,...ctx.groupB])].map(x=>[x.pocho.id,x.pocho.everStuck]));ctx.preGroupSize=new Map([...new Set([...ctx.groupA,...ctx.groupB])].map(x=>[x.pocho.id,getGroup(x).length]));ctx.prePairStickCount=contactRec(a,b).stickCount||0;const len=(a.pocho.radius+b.pocho.radius)*.93,c=Constraint.create({bodyA:a,bodyB:b,length:len,stiffness:.055,damping:.14,render:{visible:false}});c.pochoBond={createdAt:performance.now(),rest:len};Composite.add(engine.world,c);bonds.add(c);
 for(const [x,y] of [[a,b],[b,a]]){const p=x.pocho,r=contactRec(x,y);p.stickCount++;p.everStuck=true;p.aloneSince=performance.now();r.everStuck=true;r.stickCount=(r.stickCount||0)+1;r.lastStickAt=performance.now();r.lastStickExpression=p.expression;p.lastEvent='stick';p.lastEventAt=performance.now()}
 const before=ctx.groupA.length>=ctx.groupB.length?ctx.groupA:ctx.groupB;ctx.groupBefore=before;ctx.groupAfter=getGroup(a);ctx.newlyJoined=before.includes(a)?b:a;recordGroups(ctx.groupAfter);runStats.sticks++;save.totals.sticks++;lastActivity=performance.now();
}
function recordGroups(g){const ids=g.map(x=>x.pocho.id).sort();for(const b of g){b.pocho.maxGroup=Math.max(b.pocho.maxGroup,g.length);b.pocho.groupsHistory.push(ids);if(b.pocho.groupsHistory.length>8)b.pocho.groupsHistory.shift()}}
function isBonded(a,b){for(const c of bonds)if((c.bodyA===a&&c.bodyB===b)||(c.bodyA===b&&c.bodyB===a))return true;return false}
function getGroup(start){if(!start?.pocho)return[];const out=[],seen=new Set([start]),stack=[start];while(stack.length){const b=stack.pop();out.push(b);for(const c of bonds){let n=null;if(c.bodyA===b)n=c.bodyB;else if(c.bodyB===b)n=c.bodyA;if(n?.pocho&&!seen.has(n)){seen.add(n);stack.push(n)}}}return out}
function breakBond(c){const a=c.bodyA,b=c.bodyB;if(!a?.pocho||!b?.pocho)return;Composite.remove(engine.world,c);bonds.delete(c);const now=performance.now();for(const [x,y] of [[a,b],[b,a]]){x.pocho.detachCount++;x.pocho.aloneSince=now;x.pocho.lastEvent='detach';x.pocho.lastEventAt=now;const r=contactRec(x,y);r.detachCount++}pushRecent({type:'detach',time:now,x:(a.position.x+b.position.x)/2,y:(a.position.y+b.position.y)/2})}
function popGroup(origin,ctx){
 const victims=getGroup(origin);ctx.primary=origin;ctx.victims=[...victims];ctx.causeChain=buildCauseChain(origin);ctx.x=origin.position.x;ctx.y=origin.position.y;const beforeNear=getNearby(ctx.x,ctx.y,T.NEAR*1.25,[]);const remainingNear=beforeNear.filter(x=>!victims.includes(x));ctx.densityWillResolve=beforeNear.length>=8&&remainingNear.length<=Math.max(3,beforeNear.length-victims.length);scoreEvent(ctx);
 const now=performance.now();for(const witness of bodies){if(victims.includes(witness)||!witness.pocho)continue;if(Math.hypot(witness.position.x-origin.position.x,witness.position.y-origin.position.y)<170)witness.pocho.popWitnessed+=Math.max(0,victims.length-1)}
 runStats.pops++;runStats.induced+=Math.max(0,victims.length-1);save.totals.pops++;save.totals.induced+=Math.max(0,victims.length-1);
 for(const c of [...bonds])if(victims.includes(c.bodyA)||victims.includes(c.bodyB)){Composite.remove(engine.world,c);bonds.delete(c)}
 for(const b of victims){spawnPopFx(b);Composite.remove(engine.world,b);bodies.delete(b)}lastActivity=now;
}
function buildCauseChain(b){const arr=[b],seen=new Set([b.pocho.id]);let id=b.pocho.lastPushedBy;for(let i=0;i<6&&id;i++){const n=[...bodies].find(x=>x.pocho.id===id);if(!n||seen.has(id))break;arr.unshift(n);seen.add(id);id=n.pocho.lastPushedBy}return arr}

function scoreEvent(ctx){
 const matched=[];for(const r of DATA.roles){if(!r.active||r.trigger!==ctx.trigger)continue;let ok=false;try{ok=roleMatch(r,ctx)}catch{}if(ok)matched.push(r)}if(!matched.length)return;
 matched.sort((a,b)=>b.rarity-a.rarity||b.score-a.score);const total=matched.reduce((s,r)=>s+r.score,0),rep=matched[0];score+=total;save.totals.score+=total;runStats.rolesTriggered+=matched.length;runStats.maxRarity=Math.max(runStats.maxRarity,rep.rarity);runStats.maxSingle=Math.max(runStats.maxSingle,total);
 let repNew=false;for(const r of matched){const key=String(r.id),entry=save.roles[key]||(save.roles[key]={discovered:false,count:0,best:0,first:null});if(!entry.discovered){entry.discovered=true;entry.first=new Date().toISOString();runStats.newRoles.add(r.id);if(r.id===rep.id)repNew=true}entry.count++;entry.best=Math.max(entry.best,total)}persist();showScorePop(ctx.x,ctx.y,rep,total,repNew);pushRecent({type:'score',time:performance.now(),score:total,x:ctx.x,y:ctx.y});updateHud();}
function roleMatch(r,ctx){
 // check from primary perspective, then secondary when pair-level role can naturally be symmetric
 const parts=r.condition.split('＋').map(s=>s.trim());if(parts.every(c=>checkClause(c,ctx,ctx.primary||ctx.a,ctx.other||ctx.b)))return true;
 if(ctx.b&&parts.every(c=>checkClause(c,ctx,ctx.b,ctx.a)))return true;return false;
}
function showScorePop(x,y,role,points,isNew){const el=document.createElement('div');el.className='score-pop rarity-'+role.rarity;const size=Math.max(18,Math.min(42,17+Math.log10(Math.max(10,points))*7));const safeX=Math.max(72,Math.min(W-72,x));const topPad=Math.max(64,size*1.9),bottomPad=Math.max(58,size*1.35);const safeY=Math.max(topPad,Math.min(H-bottomPad,y));el.style.fontSize=size+'px';el.style.left=(safeX/W*100)+'%';el.style.top=(safeY/H*100)+'%';el.innerHTML=(isNew?'<span class="new">NEW</span>':'')+`<span class="role">${escapeHtml(role.name)}</span><span class="points">+${points.toLocaleString()}</span>`;scoreLayer.appendChild(el);setTimeout(()=>el.remove(),1150)}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function pushRecent(e){recentEvents.push(e);const t=performance.now()-15000;while(recentEvents.length&&recentEvents[0].time<t)recentEvents.shift()}
function spawnPopFx(b){const p=document.createElement('div');p.className='score-pop';p.style.left=(b.position.x/W*100)+'%';p.style.top=(b.position.y/H*100)+'%';p.style.fontSize='24px';p.style.color=b.pocho.hex;p.textContent='ぽちょ';scoreLayer.appendChild(p);setTimeout(()=>p.remove(),650)}

function getNearby(x,y,r,exclude=[]){const ex=new Set(exclude);return [...bodies].filter(b=>b.pocho&&!ex.has(b)&&Math.hypot(b.position.x-x,b.position.y-y)<=r)}
function tick(){if(state!=='game'||paused)return;const now=performance.now();confinePrelaunchSet();wallChecks();for(const b of bodies){if(!b.pocho?.launched)continue;const p=b.pocho,dt=Math.max(0,(now-p.lastUpdate)/1000);p.lastUpdate=now;p.distance+=speed(b)*dt*60;p.maxSpeed=Math.max(p.maxSpeed,speed(b));if(speed(b)>=T.HIGH)p.highSpeedSeen=true;Body.applyForce(b,b.position,{x:0,y:-b.mass*PHYS.UP_FORCE});const m=speed(b);if(m>PHYS.MAX_SPEED){const s=PHYS.MAX_SPEED/m;Body.setVelocity(b,{x:b.velocity.x*s,y:b.velocity.y*s})}if(Math.abs(b.angularVelocity)>PHYS.MAX_ANG)Body.setAngularVelocity(b,Math.sign(b.angularVelocity)*PHYS.MAX_ANG);if(m<T.STILL){if(!p.stillSince)p.stillSince=now;if(now-p.stillSince>5000)p.longStill=true}else p.stillSince=0;}
 for(const c of [...bonds]){if(!c.bodyA?.pocho||!c.bodyB?.pocho){bonds.delete(c);continue}const d=Math.hypot(c.bodyA.position.x-c.bodyB.position.x,c.bodyA.position.y-c.bodyB.position.y),rv=Math.hypot(c.bodyA.velocity.x-c.bodyB.velocity.x,c.bodyA.velocity.y-c.bodyB.velocity.y);if(now-c.pochoBond.createdAt>450&&(d>c.pochoBond.rest*1.82||rv>13.2))breakBond(c)}
 if(remaining===0&&!currentSet){const active=[...bodies].some(b=>speed(b)>1.1);if(!active&&now-lastActivity>1200){if(!settleSince)settleSince=now;if(now-settleSince>1500)finishGame()}else settleSince=0;}
}
function drawOverlay(){if(!render)return;const ctx=render.context;ctx.save();const zt=launchZoneTop();ctx.fillStyle='#f7f3ecb8';ctx.fillRect(0,zt,W,H-zt);ctx.strokeStyle='#9c8f7f80';ctx.setLineDash([7,7]);ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,zt);ctx.lineTo(W,zt);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#766d63a8';ctx.font='600 12px system-ui';ctx.textAlign='left';ctx.fillText('射出ゾーン',12,zt+20);ctx.strokeStyle='#ffffffaa';ctx.lineWidth=2;ctx.strokeRect(1,1,W-2,H-2);for(const c of bonds){if(!c.bodyA?.pocho||!c.bodyB?.pocho)continue;ctx.lineWidth=7;ctx.lineCap='round';ctx.strokeStyle='#ffffff45';ctx.beginPath();ctx.moveTo(c.bodyA.position.x,c.bodyA.position.y);ctx.lineTo(c.bodyB.position.x,c.bodyB.position.y);ctx.stroke()}if(currentSet&&!currentSet.launched){for(const c of currentSet.links){ctx.lineWidth=5;ctx.lineCap='round';ctx.strokeStyle='#8e817151';ctx.beginPath();ctx.moveTo(c.bodyA.position.x,c.bodyA.position.y);ctx.lineTo(c.bodyB.position.x,c.bodyB.position.y);ctx.stroke()}}for(const b of bodies)if(b.pocho)drawPocho2D(ctx,b.position.x,b.position.y,b.pocho.radius,b.pocho,b.angle);if(dragging&&grabConstraint&&grabbed){ctx.strokeStyle='#846f59a0';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(grabConstraint.pointA.x,grabConstraint.pointA.y);ctx.lineTo(grabbed.position.x,grabbed.position.y);ctx.stroke();ctx.beginPath();ctx.arc(grabConstraint.pointA.x,grabConstraint.pointA.y,8,0,Math.PI*2);ctx.stroke()}ctx.restore()}
function drawPocho2D(ctx,x,y,r,p,angle=0){ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.fillStyle=p.hex;ctx.strokeStyle='#ffffff90';ctx.lineWidth=Math.max(1.5,r*.065);ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle=ctx.strokeStyle='#4e4a53c9';ctx.lineWidth=Math.max(1.5,r*.06);ctx.lineCap='round';const ex=r*.28,ey=-r*.12,er=Math.max(1.5,r*.055);ctx.beginPath();ctx.arc(-ex,ey,er,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(ex,ey,er,0,Math.PI*2);ctx.fill();ctx.beginPath();if(p.expression==='ごきげん')ctx.arc(0,r*.02,r*.27,.15*Math.PI,.85*Math.PI);else if(p.expression==='不機嫌')ctx.arc(0,r*.34,r*.24,1.18*Math.PI,1.82*Math.PI);else{ctx.moveTo(-r*.18,r*.18);ctx.lineTo(r*.18,r*.18)}ctx.stroke();drawDecoration(ctx,r,p.decoration);ctx.restore()}
function drawDecoration(ctx,r,d){ctx.strokeStyle='#55505acb';ctx.fillStyle='#fff8';ctx.lineWidth=Math.max(1.4,r*.055);if(d==='リボン'){ctx.fillStyle='#f8d0dc';ctx.beginPath();ctx.ellipse(-r*.2,-r*.8,r*.25,r*.14,-.5,0,Math.PI*2);ctx.ellipse(r*.2,-r*.8,r*.25,r*.14,.5,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(0,-r*.8,r*.10,0,Math.PI*2);ctx.fill()}else if(d==='メガネ'){ctx.beginPath();ctx.arc(-r*.27,-r*.1,r*.17,0,Math.PI*2);ctx.arc(r*.27,-r*.1,r*.17,0,Math.PI*2);ctx.moveTo(-r*.1,-r*.1);ctx.lineTo(r*.1,-r*.1);ctx.stroke()}else if(d==='王冠'){ctx.fillStyle='#f2d574';ctx.beginPath();ctx.moveTo(-r*.34,-r*.78);ctx.lineTo(-r*.26,-r*1.15);ctx.lineTo(-r*.05,-r*.91);ctx.lineTo(r*.12,-r*1.18);ctx.lineTo(r*.32,-r*.83);ctx.closePath();ctx.fill();ctx.stroke()}else if(d==='芽'){ctx.strokeStyle='#579463';ctx.beginPath();ctx.moveTo(0,-r*.78);ctx.quadraticCurveTo(0,-r*1.15,r*.16,-r*1.27);ctx.stroke();ctx.fillStyle='#8bc691';ctx.beginPath();ctx.ellipse(r*.18,-r*1.25,r*.18,r*.09,-.45,0,Math.PI*2);ctx.fill()}}

function finishGame(){if(state!=='game')return;const final=score,old=save.best[modeKey]||0,isRecord=final>old;if(isRecord)save.best[modeKey]=final;save.plays[modeKey]=(save.plays[modeKey]||0)+1;persist();teardownPhysics();showResult(final,isRecord)}
function showResult(final,isRecord){showScreen('result');$('#result-score').textContent=final.toLocaleString();$('#result-record').textContent=isRecord?'NEW RECORD!':'';const d=$('#result-details');d.innerHTML='';const arr=[['MODE',MODES[modeKey].label],['最高レア',runStats.maxRarity?'★'+runStats.maxRarity:'なし'],['発生役',runStats.rolesTriggered],['NEW',runStats.newRoles.size],['最大単発',runStats.maxSingle.toLocaleString()],['誘爆',runStats.induced]];for(const [a,b] of arr){const x=document.createElement('div');x.className='result-detail';x.innerHTML=`<small>${a}</small><b>${b}</b>`;d.appendChild(x)}}

function renderBook(){const list=$('#book-list'),active=DATA.roles.filter(r=>r.active&&r.rarity<=5),found=active.filter(r=>save.roles[String(r.id)]?.discovered).length;$('#book-summary').textContent=`発見 ${found} / ${active.length}`;list.innerHTML='';for(const r of active){const rec=save.roles[String(r.id)],found=!!rec?.discovered,card=document.createElement('div');card.className='role-card '+(found?'':'locked');card.innerHTML=`<div class="role-top"><span class="stars rarity-${r.rarity}">${'★'.repeat(r.rarity)}</span><span class="role-name">${found?escapeHtml(r.name):'？？？？？？'}</span></div><p>${escapeHtml(found?r.discovered:r.undiscovered)}</p>${found?`<div class="role-meta"><span>発見 ${rec.count}回</span><span>最高 +${rec.best.toLocaleString()}</span></div>`:''}`;list.appendChild(card)} }
function renderStats(){const c=$('#stats-content');const discovered=Object.values(save.roles).filter(x=>x.discovered).length;c.innerHTML=`<div class="stats-grid"><div class="stat-card"><small>発見した役</small><b>${discovered}</b></div><div class="stat-card"><small>総射出</small><b>${save.totals.shots.toLocaleString()}</b></div><div class="stat-card"><small>総接着</small><b>${save.totals.sticks.toLocaleString()}</b></div><div class="stat-card"><small>総起爆</small><b>${save.totals.pops.toLocaleString()}</b></div></div>`;for(const k of ['short','middle','long']){const x=document.createElement('div');x.className='mode-stat';x.innerHTML=`<h3>${MODES[k].label}</h3><div class="stats-grid"><div class="stat-card"><small>最高得点</small><b>${(save.best[k]||0).toLocaleString()}</b></div><div class="stat-card"><small>プレイ回数</small><b>${save.plays[k]||0}</b></div></div>`;c.appendChild(x)}}
window.addEventListener('resize',()=>{if(!render)return;measure();render.options.width=W;render.options.height=H;render.canvas.width=W*render.options.pixelRatio;render.canvas.height=H*render.options.pixelRatio;render.canvas.style.width=W+'px';render.canvas.style.height=H+'px';render.bounds.max.x=W;render.bounds.max.y=H;rebuildWalls()},{passive:true});
renderBook();renderStats();showScreen('menu');
})();
