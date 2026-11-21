/* 戦国VS — planned products and purchase-link presentation only.
 * This module does not charge, grant ownership, change a save, or use storage.
 */
(function (root) {
  'use strict';

  // Keep disabled until payment confirmation and authoritative entitlements
  // are implemented. A URL by itself must never start a sale.
  const CONFIG = Object.freeze({launchEnabled:false, currency:'JPY', locale:'ja-JP'});
  const PRODUCTS = Object.freeze([
    {
      id:'gold-banner',
      name:'金彩の旗印',
      kind:'cosmetic',
      priceYen:480,
      billingPeriod:'one_time',
      summary:'領主と旗印を金色の意匠で彩る、外観セットを予定しています。',
      benefits:['領主表示の金彩の装飾を予定', '旗印の金色の意匠を予定'],
      previewKey:'gold-banner',
      previewLabel:'金彩の旗印・外観イメージ',
      previewDescription:'金色の縁取りと旗の意匠を、領主表示に添えるイメージです。',
      availability:'preparing',
      purchaseUrl:'',
      taxIncluded:true,
      priceIsTentative:true,
      transferable:false,
      gameplayBenefits:false
    },
    {
      id:'moonlit-castle',
      name:'月影の城下',
      kind:'cosmetic',
      priceYen:980,
      billingPeriod:'one_time',
      summary:'月明かりの雰囲気で城下町と本拠を飾る、外観セットを予定しています。',
      benefits:['城下町の月夜の外観を予定', '本拠の月明かりの装飾を予定'],
      previewKey:'moonlit-castle',
      previewLabel:'月影の城下・外観イメージ',
      previewDescription:'紺色の夜空と月明かりで、城下町と本拠を彩るイメージです。',
      availability:'preparing',
      purchaseUrl:'',
      taxIncluded:true,
      priceIsTentative:true,
      transferable:false,
      gameplayBenefits:false
    },
    {
      id:'supporter',
      name:'戦国VSサポーター',
      kind:'subscription',
      priceYen:780,
      billingPeriod:'month',
      summary:'戦国VSの開発・運営を応援する、月額プランを予定しています。',
      benefits:['サポーターの表示用バッジを予定', '継続した開発・運営を応援する月額プランを予定'],
      previewKey:'supporter',
      previewLabel:'サポーター・バッジイメージ',
      previewDescription:'戦国VSを応援する気持ちを示す、表示用バッジのイメージです。',
      availability:'preparing',
      purchaseUrl:'',
      taxIncluded:true,
      priceIsTentative:true,
      transferable:false,
      gameplayBenefits:false
    }
  ].map(product => Object.freeze({...product, benefits:Object.freeze(product.benefits)})));

  const findProduct = id => typeof id === 'string' ? PRODUCTS.find(product => product.id === id) : undefined;
  const copyProduct = product => ({...product, benefits:[...product.benefits]});

  function getConfig() {
    return {...CONFIG};
  }

  function getProducts() {
    return PRODUCTS.map(copyProduct);
  }

  function getProduct(id) {
    const product = findProduct(id);
    return product ? copyProduct(product) : null;
  }

  // Accept only explicit, unambiguous HTTPS addresses. Do not trim whitespace
  // or repair malformed URLs into destinations the operator did not specify.
  function safePurchaseUrl(value) {
    if (typeof value !== 'string' || !/^https:\/\//i.test(value) || /[\s\\\u0000-\u001f\u007f]/u.test(value)) return '';
    const authority = value.slice(8).split(/[/?#]/,1)[0];
    if (!authority || authority.includes('@')) return '';
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return '';
      return url.href;
    } catch (_) {
      return '';
    }
  }

  /**
   * Read a product ID with the default configuration for normal UI use.
   * A product copy and configuration may be passed for pure configuration
   * checks. They do not update the catalog or prove a purchase/entitlement.
   * A disabled state always has an empty URL; callers must use this URL and
   * enabled together, rather than linking directly to product.purchaseUrl.
   */
  function getPurchaseState(productOrId, config=CONFIG) {
    const id = typeof productOrId === 'string' ? productOrId : productOrId?.id;
    const registered = findProduct(id);
    const productId = typeof id === 'string' ? id : '';
    const disabled = (reason, unknown=false) => ({productId, status:unknown?'unavailable':'preparing',
      enabled:false, label:unknown?'商品を確認できません':'販売準備中', url:'', reason});
    if (!registered) return disabled('unknown_product',true);
    const product = typeof productOrId === 'string' ? registered : productOrId;
    if (config?.launchEnabled !== true) return disabled('launch_disabled');
    if (product.availability !== 'available') return disabled('product_preparing');
    if (product.purchaseUrl === '' || product.purchaseUrl == null) return disabled('missing_url');
    const url = safePurchaseUrl(product.purchaseUrl);
    if (!url) return disabled('invalid_url');
    return {productId, status:'available', enabled:true, label:'購入ページへ', url, reason:'ready'};
  }

  const api = Object.freeze({version:1, config:CONFIG, getConfig, getProducts, getProduct, getPurchaseState});
  root.SengokuPremiumCatalog = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
