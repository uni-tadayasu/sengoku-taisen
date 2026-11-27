/* The authenticated Kagoshima deputy's special commander and recovery controls. */
(function(global){
'use strict';
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function markup(game,{compact=false}={}){
  if(game?.isDeputy!==true)return '';
  const asset=game.data?.deputyAssets;if(!asset)return '';
  const officer=game.officer(asset.officerId,asset.rank),owned=game.ownsVariant(asset.officerId,asset.rank),deployed=game.state.army[0]===asset.officerId;
  const portrait=owned&&officer?.deputyExclusive===true?global.SengokuArt?.portrait?.(officer)||'':'';
  return `<section class="deputy-officer-panel${compact?' is-compact':''}" aria-label="サブ運営専用の島津義久"><div class="deputy-officer-image">${portrait||'<span aria-hidden="true">島津</span>'}</div><div class="deputy-officer-copy"><span class="deputy-officer-badge">サブ運営専用 · レリーフ絵巻</span><h3>島津義久 <b>U</b></h3><p class="deputy-officer-abilities">統率 <strong>100</strong> · 武勇 <strong>100</strong> · 知略 <strong>100</strong> · 政治 <strong>100</strong></p><p>特技：総大将${deployed?' · 本隊の総大将に配備中':owned?' · 専用絵巻を所持':' · 専用絵巻を復元できます'}</p><div class="deputy-officer-actions"><button type="button" class="button small" data-action="restore-deputy-assets">島津義久 U を復元</button><button type="button" class="button gold small" data-action="deploy-deputy-officer"${deployed&&owned?' disabled':''}>${deployed&&owned?'総大将に配備済み':'復元して総大将に配備'}</button><button type="button" class="button small" data-action="officer" data-id="${esc(asset.officerId)}">能力・絵巻を見る</button></div>${compact?'':'<p class="deputy-officer-help">サブ運営への就任中に使用できます。復元は無料で、同じ絵巻が重複して増えることはありません。</p>'}</div></section>`;
}
global.SengokuDeputyOfficer={markup};
})(typeof window!=='undefined'?window:globalThis);
