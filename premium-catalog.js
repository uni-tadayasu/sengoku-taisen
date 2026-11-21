/* 戦国VS — product information only. Ownership comes from the account service. */
(function (root) {
  'use strict';
  const CONFIG = Object.freeze({ currency: 'JPY', locale: 'ja-JP', checkoutRequiresAccount: true });
  const PRODUCTS = Object.freeze([
    {
      id: 'gold-banner', name: '金彩の旗印', kind: 'cosmetic', slot: 'nameplate', priceYen: 480, billingPeriod: 'one_time',
      summary: '深い藍の絹に金の花を織り込んだ旗印と、重厚な金彩の名札。あなたの一城を、凛とした装いに。',
      benefits: ['金刺繍と房飾りを描いた旗印', '領主名を彩る金箔調の名札', '通常の外観へいつでも切り替え'],
      previewKey: 'gold-banner', previewLabel: '金彩の旗印', previewDescription: '金の花刺繍を施した藍の旗と、金彩の名札の表示例です。名札には、接続中の領主名が表示されます。',
      art: { src: 'assets/premium/gold-banner-v1.webp', width: 1024, height: 1536, alt: '金色の花と葉の刺繍、房飾りを備えた濃紺の旗印' },
      availability: 'available', taxIncluded: true, priceIsTentative: false, transferable: false, gameplayBenefits: false
    },
    {
      id: 'moonlit-castle', name: '月影の城下', kind: 'cosmetic', slot: 'town', priceYen: 980, billingPeriod: 'one_time',
      summary: '藍の空に月が昇り、城の窓と灯籠が水面を照らす。育てた城下町を、穏やかな夜の景色へ。',
      benefits: ['月明かりと暖かな灯りを描いた城下町の背景', '施設の位置が変わらない、いつもの操作感', '通常の昼景と月夜をいつでも切り替え'],
      previewKey: 'moonlit-castle', previewLabel: '月影の城下', previewDescription: '月明かり、窓の灯り、川面の反射まで描いた完成背景です。施設の配置と操作は通常の城下町と同じです。',
      art: { src: 'assets/premium/moonlit-castle-v1.webp', width: 1536, height: 1024, alt: '月明かりの藍の空と、城や商家の暖かな灯りが川面に映る城下町' },
      availability: 'available', taxIncluded: true, priceIsTentative: false, transferable: false, gameplayBenefits: false
    },
    {
      id: 'supporter', name: '戦国VSサポーター', kind: 'subscription', slot: 'badge', priceYen: 780, billingPeriod: 'month',
      summary: '戦国VSの開発・運営を継続して応援する月額プラン。黄金の花輪と藍の宝石を、支援の証に。',
      benefits: ['利用期間中に表示できるサポーターバッジ', '表示する・しないを選べる装備切り替え', '戦力や資産の優遇を付けない継続支援'],
      previewKey: 'supporter', previewLabel: 'サポーターバッジ', previewDescription: '黄金の花輪と藍の宝石を組み合わせた、支援の証です。名札横のバッジは実際の32px表示の見本です。',
      art: { src: 'assets/premium/supporter-badge-v1.webp', width: 1254, height: 1254, alt: '藍の宝石を黄金の花と葉で囲んだサポーターメダリオン' },
      availability: 'available', taxIncluded: true, priceIsTentative: false, transferable: false, gameplayBenefits: false
    }
  ].map(product => Object.freeze({ ...product, art: Object.freeze(product.art), benefits: Object.freeze(product.benefits) })));
  const destinations = Object.freeze({
    'gold-banner': 'https://buy.stripe.com/fZu6oI3Iwdcd5kn4Um9MY04',
    'moonlit-castle': 'https://buy.stripe.com/dRmdRa6UI2xz6or1Ia9MY05',
    supporter: 'https://buy.stripe.com/7sY8wQdj6dcdbILaeG9MY06'
  });
  const find = id => typeof id === 'string' ? PRODUCTS.find(product => product.id === id) : undefined;
  const copy = product => ({ ...product, art: { ...product.art }, benefits: [...product.benefits] });
  const getProducts = () => PRODUCTS.map(copy);
  const getProduct = id => { const product = find(id); return product ? copy(product) : null; };

  // Display information and caller-provided configuration never authorize a
  // bare payment link. The runtime obtains the account-bound destination.
  function getPurchaseState(productOrId) {
    const id = typeof productOrId === 'string' ? productOrId : productOrId?.id;
    return { productId: typeof id === 'string' ? id : '', status: find(id) ? 'account_required' : 'unavailable', enabled: false, label: find(id) ? 'ゲームで購入する' : '商品を確認できません', url: '', reason: find(id) ? 'runtime_required' : 'unknown_product' };
  }

  function checkoutURL(productId, value) {
    if (!find(productId) || typeof value !== 'string' || !value.startsWith('https://') || /[\s\\\u0000-\u001f\u007f]/u.test(value)) return '';
    try {
      const url = new URL(value), expected = new URL(destinations[productId]);
      const keys = [...url.searchParams.keys()], reference = url.searchParams.get('client_reference_id');
      if (url.origin !== expected.origin || url.pathname !== expected.pathname || url.username || url.password || url.hash || keys.length !== 1 || keys[0] !== 'client_reference_id' || !/^[a-zA-Z0-9_-]{24,200}$/.test(reference || '')) return '';
      return url.href;
    } catch { return ''; }
  }

  const api = Object.freeze({ version: 2, config: CONFIG, getConfig: () => ({ ...CONFIG }), getProducts, getProduct, getPurchaseState, checkoutURL });
  root.SengokuPremiumCatalog = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
