/* Internal save barriers remain authoritative; routine progress stays silent. */
(function(global){
 'use strict';
 const routine=new Set([
  'この端末に自動保存しています','この端末に保存しています','変更を保存しています','変更を自動保存しています',
  '進行状況は自動保存されています','自動同期中。この端末で進行できます','この端末で進行中 · 自動同期しています',
  '最新の進行を反映しています','別の更新を確認したため、最新の保存を読み込んでいます',
  '領主と最新の保存を確認しています','クラウドの最新データを確認しています','進行権を確認しています',
  '領主の権限を確認しています。確認が終わるまで操作と保存を待機しています',
  '占領した拠点の集計と報酬を同期しています','共通フィールド・資産・共同普請の結果を同期しています',
  '外部に預けた兵の維持費を現在の時刻まで反映しています','共通時刻までの進行を反映しています','共通時刻を確認しています',
  '合戦と指令の結果を同期しています','兵の維持費を最新の保存と照合しています',
  '保存を確認しています','更新状況を確認しています','この領主の進行へ自動で同期します','この端末の物語に自動保存します'
 ]);
 function isRoutine(value){return routine.has(String(value??'').trim().replace(/[。.…]+$/u,''));}
 function visibleText(value){const text=String(value??'');return isRoutine(text)?'':text;}
 const api={isRoutine,visibleText};
 global.SengokuSyncNotices=api;
 if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
