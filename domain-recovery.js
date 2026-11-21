/* Domain moves never move browser storage. Recovery keeps identity and progress together. */
(function(root){
'use strict';
const FORMAT='sengoku-complete-backup',VERSION=1,MAX_FILE_BYTES=4*1024*1024;
const OLD_URL='https://uni-tadayasu.github.io/sengoku-taisen/',NEW_URL='https://www.kasai-solutions-inc.com/';
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function identity(value){
 if(!object(value)||!(typeof value.id==='string'||Number.isSafeInteger(value.id))||!String(value.id).length||String(value.id).length>=180||typeof value.token!=='string'||value.token.length<20||value.token.length>8192||/\s/.test(value.token))throw Error('領主データの認証情報を確認できません。');
 return{id:value.id,token:value.token,name:typeof value.name==='string'?value.name.slice(0,80):''};
}
function gameSave(value){
 if(!object(value)||value.game!=='sengoku-tento'||value.version!==2||!object(value.state))throw Error('戦国VSのゲームセーブを選んでください。');
 return value;
}
function parse(value){
 if(!object(value))throw Error('領主データ、ゲームセーブ、または統合バックアップを選んでください。');
 if(value.format===FORMAT){if(value.version!==VERSION)throw Error('この統合バックアップのバージョンには対応していません。');return{identity:identity(value.identity),save:gameSave(value.save),kind:'complete'};}
 if(value.game==='sengoku-tento')return{identity:null,save:gameSave(value),kind:'game'};
 if(value.format!==undefined&&value.format!=='sengoku-lord-identity')throw Error('このファイルは戦国VSの領主データとして読み込めません。');
 if(value.version!==undefined&&value.version!==1)throw Error('領主データのバージョンを確認してください。');
 return{identity:identity(value),save:null,kind:'identity'};
}
function combine(values,pending=null){
 if(!Array.isArray(values)||values.length<1||values.length>2)throw Error('統合バックアップ1個、または領主データとゲームセーブの2個を選んでください。');
 let foundIdentity=null,save=null,kind='identity';
 for(const value of values){const part=parse(value);if(part.identity){if(foundIdentity)throw Error('領主データは1人分だけ選んでください。');foundIdentity=part.identity;}if(part.save){if(save)throw Error('ゲームセーブは1個だけ選んでください。');save=part.save;}if(part.kind==='complete')kind='complete';}
 if(!foundIdentity&&pending?.identity)foundIdentity=identity(pending.identity);
 if(!foundIdentity)throw Error('これはゲームの進行だけのファイルです。領主データも一緒に選ぶか、先に接続コードで領主を確認してください。');
 return{identity:foundIdentity,save,kind:save?(kind==='complete'?'complete':'files'):'identity'};
}
async function readFiles(files,pending=null){
 const list=Array.from(files||[]);if(!list.length)return null;
 if(list.length>2||list.some(file=>!Number.isSafeInteger(file.size)||file.size<1||file.size>MAX_FILE_BYTES)||list.reduce((sum,file)=>sum+file.size,0)>MAX_FILE_BYTES+32768)throw Error('復旧ファイルは1個4MBまで、合計2個まで選べます。');
 const values=[];for(const file of list){let value;try{value=JSON.parse(await file.text());}catch(_){throw Error('JSONファイルを読み取れませんでした。書き出した元のファイルを選んでください。');}values.push(value);}
 return combine(values,pending);
}
function createBackup(currentIdentity,save,{name='',sourceOrigin='',exportedAt=new Date().toISOString()}={}){
 const owner=identity({...currentIdentity,name});return{format:FORMAT,version:VERSION,exportedAt,sourceOrigin:String(sourceOrigin).slice(0,500),identity:owner,save:gameSave(save)};
}
function summaryHtml(summary={}){
 const turn=Number.isSafeInteger(summary.turn)&&summary.turn>=0?summary.turn:0,month=turn%672;
 const castle=root.SENGOKU_DATA?.castles?.find(c=>c.id===summary.home)?.name||summary.home||'保存された本拠';
 return`<dl class="social-confirm-details"><dt>勢力</dt><dd>${escape(summary.clan||'保存された勢力')}</dd><dt>本拠</dt><dd>${escape(castle)}</dd><dt>年月</dt><dd>${1560+Math.floor(month/12)}年 ${month%12+1}月</dd><dt>所持武将</dt><dd>${Number.isSafeInteger(summary.officers)?summary.officers:0}人</dd></dl>`;
}
function operatorRecoveryForm(){
 return`<section class="domain-recovery-card domain-recovery-operator"><span class="domain-recovery-step">運営登録済みの方へ</span><h3>運営登録キーで復旧</h3><p>運営本人として確認できた端末にだけ表示しています。初回に使用した運営登録キーで、同じ運営の領主IDへの接続を確認できます。以前の端末の接続はそのまま使えます。</p><form id="social-admin-recovery-form" class="domain-recovery-key-form"><label for="social-recovery-key">初回に使用した運営登録キー</label><div class="social-inline-form"><input id="social-recovery-key" name="key" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="256" placeholder="運営登録キー" aria-describedby="social-recovery-key-help" required><button class="social-button primary" type="submit">運営権限の確認に進む</button></div></form><p id="social-recovery-key-help" class="social-small">キーは入力後に消去し、ブラウザの保存やバックアップには含めません。役職を確認したあと、使うゲーム進行を選びます。</p><p><strong>権限の復旧と、ゲームの進行の復元は別です。</strong>サーバーに進行が未保存の場合、以前の城・武将・資源を戻すには以前のゲームセーブが必要です。この端末の現在の進行を使う場合は、内容を確認してから選べます。</p><details class="domain-recovery-help"><summary>運営登録キーが見つからない場合</summary><p>以前の端末の接続コード、領主データ、または統合バックアップを使ってください。キーも以前の認証情報もない場合、この画面だけでは本人確認ができません。ゲームセーブだけでは運営権限は復旧できません。</p><button class="social-button" data-social="recovery-files">領主データ・バックアップを選ぶ</button></details></section>`;
}
function guidance({adminRegistered=false,hasIdentity=false,operatorRecoveryAllowed=false}={}){
 return`<div class="domain-recovery-intro"><div class="social-eyebrow">CONTINUE YOUR STORY</div><h2>以前の領主で再接続</h2><p>サイトのアドレスが変わると、ブラウザは別の場所として扱います。以前の端末に保存された領主情報とゲームの進行を、ここへ引き継げます。</p>${adminRegistered?'<p class="domain-recovery-status">以前の領主として接続すると、サーバーに保存された進行と設定を確認できます。</p>':''}</div><div data-operator-recovery>${operatorRecoveryAllowed===true?operatorRecoveryForm():''}</div><section class="domain-recovery-card"><span class="domain-recovery-step">保存ファイルがある</span><h3>領主データとゲームの進行を読み込む</h3><p>新しい「統合バックアップ」なら1個。以前の書き出しなら「領主データ」と「ゲームセーブ」の2個を選んでください。領主だけのファイルも先に確認できます。</p><button class="social-button primary" data-social="recovery-files">領主データ・セーブを選ぶ</button><p class="social-small">読み込み後に領主と保存内容を確認します。このボタンだけで現在の進行が置き換わることはありません。</p></section><details class="domain-recovery-help"><summary>以前の画面が開ける・旧アドレスから転送される場合</summary><ol><li>以前遊んでいた画面が残っていれば、閉じずに使ってください。「交流 → 端末同期」で領主データを、「保存・設定」でゲームセーブを書き出せます。新しい画面では「統合バックアップ」も使えます。</li><li>旧アドレスから新しいサイトへ転送される場合、新サイトから旧サイトのブラウザ保存を直接読むことはできません。</li><li>以前ホーム画面に追加したアプリがある場合、通信を切った状態で旧画面を開けることがあります。開けたら先にファイルを書き出し、その後で通信を戻してください。旧画面が保存されていない場合は開けません。</li></ol><p>ブラウザのサイトデータは消さずに残してください。新しい領主を登録し直す必要はありません。元の領主への接続を復旧します。</p><a href="${OLD_URL}" target="_blank" rel="noopener">以前のアドレスを別のタブで確認</a></details>${hasIdentity?'<section class="domain-recovery-card"><span class="domain-recovery-step">この端末の備え</span><h3>領主と進行を、一つのファイルに</h3><p>統合バックアップには本人の認証情報が含まれます。自分の端末への移行用に保管してください。</p><button class="social-button" data-social="recovery-export">統合バックアップを書き出す</button></section>':''}`;
}
const api={FORMAT,VERSION,MAX_FILE_BYTES,OLD_URL,NEW_URL,parse,combine,readFiles,createBackup,summaryHtml,operatorRecoveryForm,guidance};root.SengokuDomainRecovery=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
