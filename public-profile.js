/* Public, read-only lord profiles. Account controls live in the owner's separate Lord tab. */
(function(global){
'use strict';
const doc=global.document;
const ranks=new Set(['D','C','B','A','S','SS','SSS','U']);
const officers=new Map((global.SENGOKU_OFFICERS||[]).map(person=>[person.id,person]));
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const validId=id=>typeof id==='string'&&/^u_[A-Za-z0-9_]{1,96}$/.test(id);
const clanName=clan=>clan==='德川家'?'徳川家':clan||'浪人';
const searches=new WeakMap();
let dialog=null,selection=null,sequence=0,timer=null,opener=null;
function patch(host,html,key){
  if(global.SengokuStableDOM){
    const result=global.SengokuStableDOM.patch(host,html,{key});
    if(result.artwork)global.SengokuArt?.schedule?.();
    return;
  }
  if(host.innerHTML!==html)host.innerHTML=html;
}
function commanderCard(commander){
  if(commander==null){
    const text=commander===null?'未編成':'公開情報を確認中';
    return `<section class="lord-commander lord-commander-empty"><div><h3>総大将</h3><p>${text}</p></div></section>`;
  }
  const officer=officers.get(commander.officerId);
  if(!officer||!ranks.has(commander.rank))return '<section class="lord-commander lord-commander-empty"><div><h3>総大将</h3><p>武将情報を確認できません</p></div></section>';
  const name=officer.name==='德川家康'?'徳川家康':officer.name;
  const portrait=global.SengokuArt?.portrait?.({...officer,rank:commander.rank})||'';
  return `<section class="lord-commander" data-officer-id="${esc(officer.id)}" data-officer-rank="${commander.rank}"><div class="lord-commander-portrait">${portrait}</div><div class="lord-commander-copy"><h3>総大将</h3><p class="lord-commander-name">${esc(name)}</p><p class="lord-commander-rank">ランク <b>${commander.rank}</b></p></div></section>`;
}
function paintCommander(host,commander,owner){patch(host,commanderCard(commander),owner);}
function profileButton(person,label='公開プロフィールを見る'){
  return validId(person?.id)?`<button type="button" class="lord-profile-link" data-public-profile="${esc(person.id)}" aria-label="${esc(person.name||'領主')}の公開プロフィールを見る">${esc(label)}</button>`:'';
}
function linkedName(id,name,markup){
  return validId(id)?`<button type="button" class="lord-profile-name" data-public-profile="${esc(id)}" aria-label="${esc(name)}の公開プロフィールを見る">${markup}</button>`:markup;
}
function directory(){
  return '<section class="lord-directory" data-public-player-search><form id="public-lord-search"><label for="public-lord-query">領主プロフィールを探す</label><div><input id="public-lord-query" name="q" maxlength="98" required placeholder="領主名または領主ID" autocomplete="off"><button type="submit" class="social-button">検索</button></div></form><p data-search-status role="status"></p><div data-search-list></div></section>';
}
function ensureDialog(){
  if(dialog)return dialog;
  dialog=doc.createElement('dialog');dialog.id='public-lord-profile';dialog.className='public-lord-profile';dialog.setAttribute('aria-labelledby','public-lord-title');
  dialog.innerHTML='<header><h2 id="public-lord-title">領主プロフィール</h2><button type="button" class="social-button" data-profile-close autofocus>閉じる</button></header><div data-profile-body></div><footer class="lord-profile-share" hidden><button type="button" class="social-button" data-profile-copy>公開リンクをコピー</button><label hidden>公開リンク<input type="url" readonly data-profile-url></label><p role="status" data-copy-status></p></footer><div class="lord-profile-feedback"><p role="status" data-profile-status></p><button type="button" class="social-button" data-profile-retry hidden>再読み込み</button></div>';
  dialog.addEventListener('close',()=>{
    // A queued close event may arrive after the same dialog was reopened.
    if(dialog.open)return;
    sequence++;clearTimeout(timer);timer=null;selection=null;
    const target=opener;opener=null;
    if(target?.isConnected&&doc.activeElement!==target)target.focus({preventScroll:true});
  });
  doc.body.append(dialog);return dialog;
}
function detail(person){
  const name=global.SengokuPremiumRuntime?.nameMarkup?.(person.name,person.appearance)||esc(person.name);
  const avatar=global.SengokuAvatar?.markup?.(person,'profile')||'';
  const office=global.SengokuPublicCourt?.slot?.({playerId:person.id,courtOffice:person.courtOffice})||'';
  const evaluation=global.SengokuEvaluationUI?.badge?.(person.evaluation)||'';
  const guild=person.guildName?' · '+esc(person.guildName):'';
  return `<div class="lord-public-identity">${avatar}<div><h3>${name}</h3><p>${esc(clanName(person.clan))}${guild}</p><div class="lord-public-badges">${office}${evaluation}</div></div></div><div data-public-commander>${commanderCard(person.commander)}</div>`;
}
function status(text,retry=false){
  const node=dialog.querySelector('[data-profile-status]');
  if(node.textContent!==text)node.textContent=text;
  const button=dialog.querySelector('[data-profile-retry]');
  if(button.hidden===retry)button.hidden=!retry;
}
function schedule(id){
  clearTimeout(timer);
  if(!doc.hidden&&dialog?.open&&selection===id)timer=setTimeout(()=>load(id),15000);
}
async function load(id){
  const generation=++sequence;clearTimeout(timer);
  const current=()=>sequence===generation&&dialog?.open&&selection===id;
  const host=dialog.querySelector('[data-profile-body]');
  try{
    const result=await global.SengokuSocial.getPublicProfile(id);
    if(!current())return;
    if(!result?.player||result.player.id!==id)throw Error('領主を確認できません');
    patch(host,detail(result.player),id);dialog.querySelector('.lord-profile-share').hidden=false;status('');
  }catch(error){
    if(!current())return;
    if(error?.status===404||error?.status===403){
      dialog.querySelector('.lord-profile-share').hidden=true;patch(host,'',id);status('この領主の公開プロフィールは現在閲覧できません。');return;
    }
    status('公開プロフィールを更新できませんでした。通信状態を確認して再読み込みしてください。',true);
  }
  if(current())schedule(id);
}
function open(id,trigger){
  if(!validId(id))return;
  ensureDialog();clearTimeout(timer);opener=trigger||doc.activeElement;selection=id;
  dialog.querySelector('.lord-profile-share').hidden=true;dialog.querySelector('[data-profile-url]').parentElement.hidden=true;
  dialog.querySelector('[data-copy-status]').textContent='';
  patch(dialog.querySelector('[data-profile-body]'),'',id);status('公開プロフィールを読み込んでいます。');
  if(!dialog.open)dialog.showModal();
  return load(id);
}
function sharedURL(id){
  const url=new URL(global.location.origin);url.pathname=global.location.pathname;
  url.searchParams.set('lord',id);return url.href;
}
async function copyLink(){
  const id=selection;if(!id)return;
  const url=sharedURL(id),feedback=dialog.querySelector('[data-copy-status]');
  try{
    await global.navigator.clipboard.writeText(url);
    if(dialog.open&&selection===id)feedback.textContent='公開リンクをコピーしました。';
  }catch(_){
    if(!dialog.open||selection!==id)return;
    const input=dialog.querySelector('[data-profile-url]');input.value=url;input.parentElement.hidden=false;
    input.focus();input.select();feedback.textContent='選択したリンクをコピーしてください。';
  }
}
function openShared(){
  const id=new URLSearchParams(global.location?.search||'').get('lord');
  if(validId(id))open(id,doc.getElementById('launch-enter'));
}
function click(event){
  const button=event.target?.closest?.('[data-public-profile],[data-profile-close],[data-profile-retry],[data-profile-copy]');
  if(!button||button.disabled)return;
  if(button.hasAttribute('data-public-profile')){event.preventDefault();open(button.dataset.publicProfile,button);}
  else if(button.hasAttribute('data-profile-close'))dialog?.close();
  else if(button.hasAttribute('data-profile-copy'))copyLink();
  else if(selection)load(selection);
}
async function search(event){
  const form=event.target;
  if(form?.id!=='public-lord-search')return;
  event.preventDefault();
  const section=form.closest('[data-public-player-search]'),input=form.querySelector('[name=q]');
  const query=input.value.normalize('NFC').trim(),length=Array.from(query).length;
  const generation=(searches.get(form)||0)+1;searches.set(form,generation);
  const summary=section.querySelector('[data-search-status]'),list=section.querySelector('[data-search-list]');
  const current=()=>form.isConnected&&searches.get(form)===generation;
  if(!validId(query)&&(length<2||length>24)){summary.textContent='領主名は2〜24文字、領主IDは全文を入力してください。';patch(list,'','results');return;}
  summary.textContent='領主を探しています。';
  try{
    const result=await global.SengokuSocial.searchPublicPlayers(query);
    if(!current())return;
    const rows=(Array.isArray(result?.players)?result.players:[]).filter(person=>validId(person?.id));
    patch(list,rows.map(person=>`<div class="lord-search-hit" data-stable-key="${esc(person.id)}"><div><strong>${esc(person.name)}</strong><small>${esc(clanName(person.clan))}</small></div>${profileButton(person,'プロフィール')}</div>`).join(''),'results');
    summary.textContent=rows.length?`「${query}」の検索結果 · ${rows.length}件`:`「${query}」に該当する領主はいません。`;
  }catch(_){if(current()){patch(list,'','results');summary.textContent='領主を検索できませんでした。もう一度検索してください。';}}
}
function visibility(){
  clearTimeout(timer);timer=null;
  if(!doc.hidden&&selection&&dialog?.open)load(selection);
}
function dispose(){
  sequence++;clearTimeout(timer);selection=null;opener=null;
  doc.removeEventListener('DOMContentLoaded',openShared);doc.removeEventListener('click',click);doc.removeEventListener('submit',search);doc.removeEventListener('visibilitychange',visibility);
  if(dialog?.open)dialog.close();dialog?.remove();
}
doc.addEventListener('click',click);doc.addEventListener('submit',search);doc.addEventListener('visibilitychange',visibility);
if(doc.readyState==='complete')queueMicrotask(openShared);else doc.addEventListener('DOMContentLoaded',openShared,{once:true});
global.SengokuLordProfile={open,commanderCard,paintCommander,profileButton,linkedName,directory,dispose};
})(typeof window!=='undefined'?window:globalThis);
