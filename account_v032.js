import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {getAuth,GoogleAuthProvider,signInAnonymously,signInWithPopup,linkWithPopup,signOut,onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {getFirestore,doc,getDoc,setDoc,collection,query,where,orderBy,limit,getDocs,getCountFromServer} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import {getFunctions,httpsCallable} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js';
import {initializeAppCheck,ReCaptchaEnterpriseProvider} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app-check.js';

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const appApi=window.POCHO_APP;
const cfg=window.POCHO_FIREBASE_CONFIG||{};
const configured=cfg.apiKey&&!String(cfg.apiKey).startsWith('YOUR_')&&cfg.projectId&&!String(cfg.projectId).startsWith('YOUR_');
let auth=null,db=null,functions=null,currentUser=null,rankMajor='normal',rankMode='short',rankPeriod='all',editingIcon=null,viewingUid=null;
let activeRun={id:null,mode:null,startPromise:null};
const metricLabels={maxChain:'最大CHAIN',maxSingleScore:'最高単発スコア',maxFever:'最多FEVER',maxGroupSize:'最大グループ人数',maxRoles:'1ゲーム最多役成立',maxSticks:'1ゲーム最多STICK',maxPops:'1ゲーム最多POP'};

function showScreen(id){$$('.screen').forEach(x=>x.classList.remove('active'));$('#screen-'+id)?.classList.add('active')}
function save(){return appApi.getSave()}
function replaceSave(v){appApi.replaceSave(v)}
function safeName(v){return String(v||'').replace(/[\n\r\t]/g,' ').trim().slice(0,12)}
function playerCode(uid){const x=String(uid||'LOCAL').replace(/[^a-z0-9]/gi,'').toUpperCase().padEnd(8,'X');return `PCH-${x.slice(0,4)}-${x.slice(4,8)}`}
function jst(){return appApi.jstParts()}
function weekly(){const weekId=appApi.isoWeekJst(),c=appApi.weeklyChoice(weekId);return {weekId,...c}}
function iconData(i){const c=appApi.colors.find(x=>x.id===(i?.color||'みずいろ'))||appApi.colors[1];return {color:c.id,hex:c.hex,expression:i?.expression||'ごきげん',sizeClass:i?.sizeClass||'中',decoration:i?.decoration||'なし',radius:i?.sizeClass==='小'?25:i?.sizeClass==='大'?38:31}}
function drawIcon(canvas,icon,size=70){if(!canvas)return;const dpr=Math.min(devicePixelRatio||1,2),css=size;canvas.width=css*dpr;canvas.height=css*dpr;canvas.style.width=css+'px';canvas.style.height=css+'px';const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,css,css);const d=iconData(icon),r=d.sizeClass==='小'?css*.24:d.sizeClass==='大'?css*.34:css*.29;appApi.drawPocho2D(ctx,css/2,css/2+2,r,d,0)}
function modal(html){const m=$('#online-modal'),c=$('#online-modal-card');c.innerHTML=html;m.classList.remove('hidden');return c}
function closeModal(){ $('#online-modal')?.classList.add('hidden') }
function alertBox(text){const c=modal(`<h3>お知らせ</h3><p class="modal-copy">${esc(text)}</p><button class="big" id="modal-ok">OK</button>`);$('#modal-ok').onclick=closeModal}
function esc(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function firebaseWarning(){const e=$('#firebase-warning');if(!configured){e.textContent='Firebase設定がまだありません。firebase-config.js にプロジェクト設定を入力するとオンライン機能が有効になります。';e.classList.remove('hidden')}else e.classList.add('hidden')}

if(configured){
 const fapp=initializeApp(cfg);auth=getAuth(fapp);db=getFirestore(fapp);functions=getFunctions(fapp,'asia-northeast1');
 const appCheckKey=String(window.POCHO_RECAPTCHA_ENTERPRISE_SITE_KEY||'').trim();
 if(appCheckKey){try{initializeAppCheck(fapp,{provider:new ReCaptchaEnterpriseProvider(appCheckKey),isTokenAutoRefreshEnabled:true})}catch(e){console.warn('App Check init failed',e)}}
 onAuthStateChanged(auth,async u=>{currentUser=u;activeRun={id:null,mode:null,startPromise:null};await refreshAuthState(u)})
} else firebaseWarning();

async function refreshAuthState(u){
 const s=save();
 if(!u){if(s.profile?.playerId){s.profile.playerId=null;s.profile.accountType='local';replaceSave(s)}updateMenuAccount();return}
 const cloud=await readPrivate(u.uid).catch(()=>null);
 if(cloud?.saveData && !s.profile?.playerId){await resolveCloudConflict(u,cloud.saveData);return}
 if(cloud?.saveData && s.profile?.playerId!==u.uid){await resolveCloudConflict(u,cloud.saveData);return}
 s.profile.playerId=u.uid;s.profile.accountType=u.isAnonymous?'guest':'google';s.profile.registeredAt=s.profile.registeredAt||new Date().toISOString();if(!s.profile.playerName){const name=await askName();if(!name){await signOut(auth);return}s.profile.playerName=name}replaceSave(s);await syncAll();updateMenuAccount();if($('#screen-login')?.classList.contains('active')){showScreen('account');renderLicense(u.uid,true)}
}
function updateMenuAccount(){const b=$('#menu-account');if(!b)return;const s=save();b.textContent=currentUser&&s.profile?.playerId?'アカウント':'ログイン'}

async function askName(initial=''){
 return new Promise(resolve=>{modal(`<h3>プレイヤー名</h3><p class="modal-copy">ランキングとぽちょ身分証に表示されます。</p><input id="name-input" class="name-input" maxlength="12" value="${esc(initial)}" placeholder="2〜12文字"><div class="modal-actions"><button id="name-cancel">やめる</button><button id="name-ok">決定</button></div>`);$('#name-cancel').onclick=()=>{closeModal();resolve(null)};$('#name-ok').onclick=()=>{const n=safeName($('#name-input').value);if(n.length<2){$('#name-input').classList.add('invalid');return}closeModal();resolve(n)}})
}

$('#menu-ranking').onclick=()=>{showScreen('ranking');renderRanking()};
$('#menu-account').onclick=()=>{if(currentUser&&save().profile?.playerId){viewingUid=currentUser.uid;showScreen('account');renderLicense(currentUser.uid,true)}else{showScreen('login');firebaseWarning()}};
$('#result-login-button').onclick=()=>{showScreen('login');firebaseWarning()};
$('#login-guest').onclick=async()=>{if(!configured)return firebaseWarning();if(!$('#terms-check').checked)return alertBox('利用規約とプライバシーポリシーへの同意が必要です。');try{await signInAnonymously(auth)}catch(e){alertBox('ゲストログインに失敗しました。'+friendly(e))}};
$('#login-google').onclick=async()=>{if(!configured)return firebaseWarning();if(!$('#terms-check').checked)return alertBox('利用規約とプライバシーポリシーへの同意が必要です。');try{await signInWithPopup(auth,new GoogleAuthProvider())}catch(e){alertBox('Googleログインに失敗しました。'+friendly(e))}};

$$('[data-rank-major]').forEach(b=>b.onclick=()=>{rankMajor=b.dataset.rankMajor;$$('[data-rank-major]').forEach(x=>x.classList.toggle('active',x===b));$('#rank-normal-controls').classList.toggle('hidden',rankMajor!=='normal');$('#weekly-head').classList.toggle('hidden',rankMajor!=='weekly');renderRanking()});
$$('[data-rank-mode]').forEach(b=>b.onclick=()=>{rankMode=b.dataset.rankMode;$$('[data-rank-mode]').forEach(x=>x.classList.toggle('active',x===b));renderRanking()});
$$('[data-rank-period]').forEach(b=>b.onclick=()=>{rankPeriod=b.dataset.rankPeriod;$$('[data-rank-period]').forEach(x=>x.classList.toggle('active',x===b));renderRanking()});

function boardInfo(){if(rankMajor==='weekly'){const w=weekly();return {boardId:`weekly_${w.weekId}_${w.mode}_${w.metric}`,mode:w.mode,metric:w.metric,label:metricLabels[w.metric],period:w.weekId}}const p=jst(),period=rankPeriod==='all'?'all':rankPeriod==='month'?p.month:p.date;return {boardId:`score_${rankPeriod}_${period}_${rankMode}`,mode:rankMode,metric:'score',label:'スコア',period}}
async function renderRanking(){const list=$('#ranking-list'),status=$('#ranking-status'),mine=$('#my-rank-card'),info=boardInfo();list.innerHTML='';mine.innerHTML='';if(rankMajor==='weekly'){$('#weekly-head').innerHTML=`<div class="weekly-theme-card"><div class="weekly-theme-kicker">今週のぽちょランキング</div><div class="weekly-theme-title">${esc(info.label)}</div><div class="weekly-theme-meta"><span class="weekly-theme-mode">${info.mode.toUpperCase()}</span><span class="weekly-theme-period">${esc(info.period)}</span></div><div class="weekly-theme-desc">${info.mode.toUpperCase()} モードで「${esc(info.label)}」を競います</div></div>`}if(!configured){status.textContent='Firebase設定後にオンラインランキングが表示されます。';renderMyLocal(mine,info);return}status.textContent='読み込み中…';try{const q=query(collection(db,'leaderboardEntries'),where('boardId','==',info.boardId),orderBy('value','desc'),orderBy('achievedAt','asc'),limit(100));const snap=await getDocs(q);status.textContent=snap.empty?'まだ記録がありません。':'';let i=0;for(const d of snap.docs){i++;list.appendChild(rankRow(i,d.data(),d.id.split('__').pop()))}await renderMyOnline(mine,info,snap.docs)}catch(e){status.textContent='ランキングを読み込めませんでした。Firebaseのインデックス設定を確認してください。';renderMyLocal(mine,info)}}
function rankRow(rank,d,uid){const row=document.createElement('button');row.className='rank-row'+(uid===currentUser?.uid?' me':'');row.innerHTML=`<span class="rank-num">${rank}</span><canvas></canvas><span class="rank-name">${esc(d.playerName||'ぽちょ')}</span><strong>${Number(d.value||0).toLocaleString()}</strong>`;drawIcon(row.querySelector('canvas'),d.icon,48);row.onclick=()=>{viewingUid=uid;showScreen('account');renderLicense(uid,uid===currentUser?.uid)};return row}
function localValue(info){const s=save(),r=s.records||{};if(info.metric!=='score')return r.weekly?.weekId===info.period?r.weekly.bestValue||0:0;if(rankPeriod==='all')return s.best?.[info.mode]||0;if(rankPeriod==='month')return r.monthly?.month===info.period?r.monthly.best?.[info.mode]||0:0;return r.daily?.date===info.period?r.daily.best?.[info.mode]||0:0}
function renderMyLocal(el,info){const v=localValue(info);el.innerHTML=currentUser?`<small>あなた</small><b>${v?v.toLocaleString():'———'}</b><span>${v?'同期待ち':'？位'}</span>`:`<small>あなた</small><b>${v?v.toLocaleString():'———'}</b><span>？位</span><em>ログインすると、次のプレイからランキングに参加できます。</em><button id="rank-login">ログイン</button>`;$('#rank-login')?.addEventListener('click',()=>{showScreen('login');firebaseWarning()})}
async function renderMyOnline(el,info,docs){const uid=currentUser?.uid;if(!uid){renderMyLocal(el,info);return}const entryRef=doc(db,'leaderboardEntries',`${info.boardId}__${uid}`),ds=await getDoc(entryRef);if(!ds.exists()){renderMyLocal(el,info);return}const me=ds.data(),v=Number(me.value||0);let rank=docs.findIndex(x=>x.id===`${info.boardId}__${uid}`)+1;if(rank<=0){const higher=await getCountFromServer(query(collection(db,'leaderboardEntries'),where('boardId','==',info.boardId),where('value','>',v)));const sameEarlier=await getCountFromServer(query(collection(db,'leaderboardEntries'),where('boardId','==',info.boardId),where('value','==',v),where('achievedAt','<',me.achievedAt)));rank=higher.data().count+sameEarlier.data().count+1}el.innerHTML=`<small>あなた</small><b>${v.toLocaleString()}</b><span>${rank.toLocaleString()}位</span>`}

async function readPrivate(uid){const d=await getDoc(doc(db,'users',uid));return d.exists()?d.data():null}
async function writeCloudSave(){if(!currentUser||!db)return;const s=save();await setDoc(doc(db,'users',currentUser.uid),{saveData:s,updatedAt:new Date().toISOString()},{merge:true});await writePublicProfile()}
async function writePublicProfile(){if(!currentUser||!db)return;const s=save(),found=Object.values(s.roles||{}).filter(x=>x.discovered).length,total=(window.POCHO_DATA?.roles||[]).filter(r=>r.active&&r.rarity<=5).length;await setDoc(doc(db,'profiles',currentUser.uid),{uid:currentUser.uid,playerId:playerCode(currentUser.uid),playerName:s.profile.playerName||'ぽちょ',registeredAt:s.profile.registeredAt||new Date().toISOString(),icon:s.profile.icon,best:s.best,playCount:Object.values(s.plays||{}).reduce((a,b)=>a+(Number(b)||0),0),book:{found,total},updatedAt:new Date().toISOString()},{merge:true})}
async function resolveCloudConflict(u,cloudSave){const local=save(),cloud=cloudSave;const hasLocal=Object.values(local.plays||{}).some(Boolean)||Object.values(local.best||{}).some(Boolean)||Object.keys(local.roles||{}).length>0;if(!hasLocal){cloud.profile=cloud.profile||{};cloud.profile.playerId=u.uid;cloud.profile.accountType=u.isAnonymous?'guest':'google';replaceSave(cloud);await syncAll();updateMenuAccount();return}await new Promise(resolve=>{const lp=Object.values(local.plays||{}).reduce((a,b)=>a+Number(b||0),0),cp=Object.values(cloud.plays||{}).reduce((a,b)=>a+Number(b||0),0),lf=Object.values(local.roles||{}).filter(x=>x.discovered).length,cf=Object.values(cloud.roles||{}).filter(x=>x.discovered).length;const c=modal(`<h3>データを選択</h3><p class="modal-copy">このGoogleアカウントにはすでにデータがあります。使用する方を選んでください。</p><div class="save-compare"><button id="use-local"><b>この端末</b><span>プレイ ${lp}回 / 図鑑 ${lf}</span><span>最高 ${Math.max(...Object.values(local.best||{}),0).toLocaleString()}</span></button><button id="use-cloud"><b>Google側</b><span>プレイ ${cp}回 / 図鑑 ${cf}</span><span>最高 ${Math.max(...Object.values(cloud.best||{}),0).toLocaleString()}</span></button></div>`);$('#use-local').onclick=async()=>{local.profile.playerId=u.uid;local.profile.accountType=u.isAnonymous?'guest':'google';local.profile.registeredAt=local.profile.registeredAt||new Date().toISOString();if(!local.profile.playerName)local.profile.playerName=await askName()||'ぽちょ';replaceSave(local);closeModal();await syncAll();resolve()};$('#use-cloud').onclick=async()=>{cloud.profile=cloud.profile||{};cloud.profile.playerId=u.uid;cloud.profile.accountType=u.isAnonymous?'guest':'google';replaceSave(cloud);closeModal();await syncAll();resolve()}})}

async function syncAll(){if(!currentUser||!db)return;await writeCloudSave()}
function callable(name){if(!functions)throw new Error('functions-not-ready');return httpsCallable(functions,name)}
async function beginVerifiedRun(detail){
 activeRun={id:null,mode:detail?.mode||null,startPromise:null};
 if(!currentUser||!functions)return;
 const mode=detail?.mode;
 const p=callable('startRun')({mode,gameVersion:'0.3.2'}).then(r=>{activeRun.id=r.data?.runId||null;return activeRun.id}).catch(e=>{console.warn('startRun failed',e);return null});
 activeRun.startPromise=p;
}
async function finishVerifiedRun(detail){
 if(!currentUser||!functions||!detail)return;
 let runId=activeRun.id;
 if(!runId&&activeRun.startPromise)runId=await activeRun.startPromise;
 if(!runId||activeRun.mode!==detail.mode){console.warn('ranking run was not verified');return}
 const s=save();
 const payload={runId,mode:detail.mode,score:Number(detail.score||0),gameVersion:'0.3.2',run:{...detail.run},playerName:s.profile?.playerName||'ぽちょ',icon:s.profile?.icon||{}};
 try{await callable('finishRun')(payload);await writeCloudSave();if($('#screen-ranking')?.classList.contains('active'))await renderRanking()}
 catch(e){console.warn('finishRun failed',e);alertBox('ランキング記録の検証に失敗しました。ゲームのローカル記録は保存されています。'+friendly(e))}
 finally{activeRun={id:null,mode:null,startPromise:null}}
}
window.addEventListener('pocho:run-started',e=>{beginVerifiedRun(e.detail)});
window.addEventListener('pocho:run-finished',async e=>{if(currentUser){try{await finishVerifiedRun(e.detail)}catch(err){console.warn('pocho secure sync failed',err)}}});
async function renderLicense(uid,isSelf=false){const host=$('#license-card');host.innerHTML='<div class="rank-status">読み込み中…</div>';let p=null;if(uid===currentUser?.uid){const s=save(),found=Object.values(s.roles||{}).filter(x=>x.discovered).length,total=(window.POCHO_DATA?.roles||[]).filter(r=>r.active&&r.rarity<=5).length;p={playerName:s.profile.playerName,playerId:playerCode(uid),registeredAt:s.profile.registeredAt,icon:s.profile.icon,best:s.best,playCount:Object.values(s.plays||{}).reduce((a,b)=>a+Number(b||0),0),book:{found,total}}}else if(db){const d=await getDoc(doc(db,'profiles',uid));if(d.exists())p=d.data()}if(!p){host.innerHTML='<div class="notice">このプレイヤーの身分証を取得できませんでした。</div>';return}host.innerHTML=`<div class="license"><div class="license-title">ぽちょ身分証 <small>POCHO PLAYER LICENSE</small></div><button class="license-icon" id="license-icon" ${isSelf?'':'disabled'}><canvas></canvas>${isSelf?'<span>タップで変更</span>':''}</button><div class="license-name">${esc(p.playerName||'ぽちょ')}</div><div class="license-id">${esc(p.playerId||playerCode(uid))}</div><div class="license-grid"><span>登録日<b>${formatDate(p.registeredAt)}</b></span><span>総プレイ回数<b>${Number(p.playCount||0).toLocaleString()}</b></span><span>SHORT最高<b>${Number(p.best?.short||0).toLocaleString()}</b></span><span>MIDDLE最高<b>${Number(p.best?.middle||0).toLocaleString()}</b></span><span>LONG最高<b>${Number(p.best?.long||0).toLocaleString()}</b></span><span>図鑑<b>${Number(p.book?.found||0)} / ${Number(p.book?.total||0)}</b></span></div></div>${isSelf?`<div class="account-actions"><button id="rename-account">名前を変える</button>${currentUser?.isAnonymous?'<button id="link-google">Googleと連携</button>':''}<button id="logout-account" class="danger">ログアウト</button></div>`:''}`;drawIcon(host.querySelector('canvas'),p.icon,112);if(isSelf){$('#license-icon').onclick=()=>openIconEditor();$('#rename-account').onclick=async()=>{const n=await askName(p.playerName||'');if(n){const s=save();s.profile.playerName=n;replaceSave(s);await syncAll();renderLicense(uid,true)}};$('#logout-account').onclick=()=>doLogout();$('#link-google')?.addEventListener('click',linkGoogle)}}
function formatDate(v){if(!v)return'—';const d=new Date(v);return Number.isNaN(d.getTime())?'—':new Intl.DateTimeFormat('ja-JP',{year:'numeric',month:'2-digit',day:'2-digit'}).format(d)}
async function doLogout(){if(!currentUser)return;const guest=currentUser.isAnonymous;const c=modal(`<h3>ログアウト</h3><p class="modal-copy">${guest?'ゲストアカウントはログアウトすると同じアカウントへ戻れません。端末のゲームデータは残ります。':'この端末のゲームデータは残ります。'}</p><div class="modal-actions"><button id="logout-no">やめる</button><button id="logout-yes" class="danger">ログアウト</button></div>`);$('#logout-no').onclick=closeModal;$('#logout-yes').onclick=async()=>{await signOut(auth);closeModal();showScreen('menu')}}
async function linkGoogle(){try{await linkWithPopup(currentUser,new GoogleAuthProvider());currentUser=auth.currentUser;const s=save();s.profile.accountType='google';replaceSave(s);await syncAll();renderLicense(currentUser.uid,true)}catch(e){if(e.code==='auth/credential-already-in-use'||e.code==='auth/account-exists-with-different-credential'){try{await signInWithPopup(auth,new GoogleAuthProvider())}catch(x){alertBox('Google連携に失敗しました。'+friendly(x))}}else alertBox('Google連携に失敗しました。'+friendly(e))}}

$('#account-back').onclick=()=>{if(viewingUid&&viewingUid!==currentUser?.uid){showScreen('ranking');renderRanking()}else showScreen('menu')};
function openIconEditor(){editingIcon=JSON.parse(JSON.stringify(save().profile.icon||{}));showScreen('icon');renderIconEditor('color')}
$('#icon-back').onclick=()=>{showScreen('account');renderLicense(currentUser.uid,true)};
$('#icon-save').onclick=async()=>{const s=save();s.profile.icon=editingIcon;replaceSave(s);if(currentUser)await syncAll();showScreen('account');renderLicense(currentUser.uid,true)};
$$('[data-icon-tab]').forEach(b=>b.onclick=()=>renderIconEditor(b.dataset.iconTab));
function renderIconEditor(tab){$$('[data-icon-tab]').forEach(b=>b.classList.toggle('active',b.dataset.iconTab===tab));drawIcon($('#icon-preview'),editingIcon,220);const box=$('#icon-options');box.innerHTML='';let vals=[];if(tab==='color')vals=appApi.colors.map(x=>x.id);if(tab==='expression')vals=appApi.expressions;if(tab==='sizeClass')vals=['小','中','大'];if(tab==='decoration')vals=appApi.decorations;for(const v of vals){const b=document.createElement('button');b.className='icon-option'+(editingIcon[tab]===v?' selected':'');if(tab==='color'){const c=appApi.colors.find(x=>x.id===v);b.innerHTML=`<i style="background:${c.hex}"></i><span>${v}</span>`}else{const cv=document.createElement('canvas');b.appendChild(cv);const span=document.createElement('span');span.textContent=v;b.appendChild(span);const tmp={...editingIcon,[tab]:v};drawIcon(cv,tmp,64)}b.onclick=()=>{editingIcon[tab]=v;renderIconEditor(tab)};box.appendChild(b)}}
function friendly(e){return e?.code?` (${e.code})`:''}
updateMenuAccount();
