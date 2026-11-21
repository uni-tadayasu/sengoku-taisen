#!/usr/bin/env node
/**
 * Notify participating IndexNow search engines after a substantive publication.
 * Default: a local dry run with zero network requests. Only --submit can POST.
 * Google does not support IndexNow; Search Console is a separate workflow.
 * A 200 means receipt, 202 means receipt with key validation pending. Neither
 * confirms indexing, ranking, or a date when a page will appear in search.
 * Official protocol: https://www.indexnow.org/documentation
 * Endpoint and participation: https://www.indexnow.org/faq
 *
 * node tools/notify-indexnow.mjs
 * node tools/notify-indexnow.mjs --submit   (only after publishing this release)
 * Do not repeatedly submit unchanged pages. No automatic retry is performed.
 */
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const SITE_ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const HOST='www.kasai-solutions-inc.com';
export const ORIGIN=`https://${HOST}`;
export const ENDPOINT='https://api.indexnow.org/indexnow';
export const URLS=Object.freeze(['/', '/guide/', '/guide/data-recovery/', '/about/'].map(p=>ORIGIN+p));
const TIMEOUT_MS=12000;
const NOTICE='IndexNow は対応検索エンジンへの更新通知です。Google は未対応です。受理は検索掲載や順位を保証しません。';

class NoticeError extends Error {
  constructor(code,message,details={}){super(message);this.code=code;this.details=details;}
}
const invalid=(code,message,details)=>{throw new NoticeError(code,message,details);};

export function parseSitemap(xml){
  if(typeof xml!=='string'||Buffer.byteLength(xml)>65536||/<!|&/u.test(xml))invalid('INVALID_SITEMAP','サイトマップの形式を確認してください。');
  const root=xml.replace(/^\s*<\?xml[^?]*\?>\s*/u,'').trim().match(/^<urlset\s+xmlns=["']http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9["']\s*>([\s\S]*)<\/urlset>$/u);
  if(!root)invalid('INVALID_SITEMAP','正規の urlset サイトマップが必要です。');
  const blocks=[...root[1].matchAll(/<url>\s*([\s\S]*?)\s*<\/url>/gu)];
  if(root[1].replace(/<url>\s*[\s\S]*?\s*<\/url>/gu,'').trim())invalid('INVALID_SITEMAP','サイトマップに未対応の項目があります。');
  const urls=blocks.map(([,body])=>{
    const match=body.match(/^<loc>([^<]+)<\/loc>\s*<lastmod>(\d{4}-\d{2}-\d{2})<\/lastmod>$/u);
    if(!match||!URLS.includes(match[1])||Number.isNaN(Date.parse(match[2]))||new Date(match[2]).toISOString().slice(0,10)!==match[2])invalid('INVALID_SITEMAP','サイトマップはこのサイトの正規 4 URL と正しい更新日のみに限定してください。');
    return match[1];
  });
  if(urls.length!==URLS.length||new Set(urls).size!==URLS.length||URLS.some(url=>!urls.includes(url)))invalid('INVALID_SITEMAP','正規 4 URL の不足・重複・追加を確認してください。');
  return [...URLS];
}

export async function loadPlan(root=SITE_ROOT){
  let config;
  try{config=JSON.parse(await readFile(path.join(root,'tools/indexnow-config.json'),'utf8'));}
  catch{invalid('INVALID_CONFIG','tools/indexnow-config.json を読み取れません。');}
  if(!config||Array.isArray(config)||config.version!==1||config.host!==HOST||!/^[0-9a-f]{32}$/u.test(config.key)||Object.keys(config).some(key=>!['version','host','key'].includes(key)))invalid('INVALID_CONFIG','固定公開ホストと 32 桁の確認キーを設定してください。');
  const keyFile=`${config.key}.txt`;
  let text;
  try{text=await readFile(path.join(root,keyFile),'utf8');}catch{invalid('LOCAL_KEY_MISSING','公開する確認テキストがありません。',{keyFile});}
  if(text.trim()!==config.key)invalid('LOCAL_KEY_MISMATCH','確認テキストの本文が設定と一致しません。',{keyFile});
  const urlList=parseSitemap(await readFile(path.join(root,'sitemap.xml'),'utf8'));
  return {keyFile,payload:{host:HOST,key:config.key,keyLocation:`${ORIGIN}/${keyFile}`,urlList}};
}

async function boundedText(response,maxBytes){
  if(Number(response.headers.get('content-length')||0)>maxBytes)invalid('RESPONSE_TOO_LARGE','公開確認の応答が大きすぎます。');
  if(!response.body)return '';
  const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let bytes=0,text='';
  try{
    for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>maxBytes)invalid('RESPONSE_TOO_LARGE','公開確認の応答が大きすぎます。');text+=decoder.decode(value,{stream:true});}
    return text+decoder.decode();
  }finally{await reader.cancel().catch(()=>{});}
}

async function request(fetchImpl,url,options,consume,timeoutMs){
  const controller=new AbortController();let timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new NoticeError('TIMEOUT','公開確認または通知がタイムアウトしました。'));},timeoutMs);});
  try{
    return await Promise.race([(async()=>{
      const response=await fetchImpl(url,{...options,redirect:'error',signal:controller.signal});
      if(response.redirected||response.url&&response.url!==url)invalid('UNEXPECTED_REDIRECT','別 URL へ転送されたため処理を中止しました。');
      return consume(response);
    })(),timeout]);
  }finally{clearTimeout(timer);}
}

const tagAttrs=tag=>Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gu)].map(m=>[m[1].toLowerCase(),m[3]]));
function validatePage(html,url,headers){
  if(!/^text\/html(?:;|$)/iu.test(headers.get('content-type')||''))invalid('PAGE_NOT_HTML','公開ページが HTML として取得できません。',{url});
  const robots=[headers.get('x-robots-tag')||'',...[...html.matchAll(/<meta\b[^>]*>/giu)].map(m=>tagAttrs(m[0])).filter(a=>['robots','googlebot','bingbot'].includes(a.name?.toLowerCase())).map(a=>a.content||'')];
  if(robots.some(value=>/\b(?:noindex|none)\b/iu.test(value)))invalid('PAGE_NOINDEX','公開ページに検索除外指定があるため通知しません。',{url});
  const canonicals=[...html.matchAll(/<link\b[^>]*>/giu)].map(m=>tagAttrs(m[0])).filter(a=>a.rel?.toLowerCase()==='canonical');
  if(canonicals.length!==1||canonicals[0].href!==url)invalid('PAGE_CANONICAL','公開ページの正規 URL が一致しません。',{url});
}

export async function verifyPublished(plan,{fetchImpl=globalThis.fetch,timeoutMs=TIMEOUT_MS}={}){
  const get=async(url,maxBytes,inspect)=>request(fetchImpl,url,{method:'GET',cache:'no-store'},async response=>{
    if(response.status!==200)invalid('PREFLIGHT_HTTP','公開確認で HTTP 200 を取得できませんでした。',{url,httpStatus:response.status});
    return inspect(await boundedText(response,maxBytes),response.headers);
  },timeoutMs);
  await get(plan.payload.keyLocation,256,text=>{if(text.trim()!==plan.payload.key)invalid('PUBLISHED_KEY_MISMATCH','公開された確認テキストの本文が一致しません。');});
  await get(`${ORIGIN}/sitemap.xml`,65536,xml=>{const urls=parseSitemap(xml);if(JSON.stringify(urls)!==JSON.stringify(plan.payload.urlList))invalid('PUBLISHED_SITEMAP_CHANGED','公開されたサイトマップが送信予定と一致しません。');});
  // All four checks must complete before the one possible POST.
  await Promise.all(plan.payload.urlList.map(url=>get(url,2*1024*1024,(html,headers)=>validatePage(html,url,headers))));
  return {keyVerified:true,sitemapVerified:true,pagesVerified:plan.payload.urlList.length};
}

export async function run({argv=[],root=SITE_ROOT,fetchImpl=globalThis.fetch,timeoutMs=TIMEOUT_MS}={}){
  let mode='dry-run',stage='local',attempted=false,summary={host:HOST,notice:NOTICE};
  try{
    if(argv.length===1&&argv[0]==='--help')return{ok:true,mode:'help',message:'node tools/notify-indexnow.mjs\n  ローカル設定・確認ファイル・正規 4 URL を検証するだけで、外部通信しません。\nnode tools/notify-indexnow.mjs --submit\n  公開後のみ実行。公開 key・sitemap・4 ページを検証して 1 回通知します。\n200: 受理。202: 受領・キー検証待ち。429/通信失敗: 非成功、自動再送なし。\n'+NOTICE};
    if(argv.length>1||argv.length===1&&argv[0]!=='--submit')invalid('INVALID_ARGUMENT','引数は --submit または --help のみです。任意 URL・ホストは指定できません。');
    mode=argv[0]==='--submit'?'submit':'dry-run';
    const plan=await loadPlan(root);
    summary={...summary,keyFile:plan.keyFile,urlCount:plan.payload.urlList.length,urls:plan.payload.urlList};
    if(mode==='dry-run')return{ok:true,mode,...summary,networkRequests:0,notificationAttempted:false,accepted:false,indexingVerified:false,message:'送信していません。公開後、内容を確認して --submit を明示してください。'};
    stage='preflight';const verified=await verifyPublished(plan,{fetchImpl,timeoutMs});summary={...summary,...verified};
    stage='notification';attempted=true;
    return await request(fetchImpl,ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json; charset=utf-8','Accept':'application/json'},body:JSON.stringify(plan.payload)},async response=>{
      const status=response.status;await response.body?.cancel().catch(()=>{});
      if(status===200)return{ok:true,mode,...summary,notificationAttempted:true,accepted:true,httpStatus:status,result:'received',keyValidationPending:false,indexingVerified:false,message:'更新通知は受理されました。検索掲載の確認ではありません。'};
      if(status===202)return{ok:true,mode,...summary,notificationAttempted:true,accepted:true,httpStatus:status,result:'received_key_pending',keyValidationPending:true,indexingVerified:false,message:'通知は受領されましたが、IndexNow 側のキー検証待ちです。受理完了や検索掲載を確認した状態ではありません。'};
      return{ok:false,mode,...summary,notificationAttempted:true,accepted:false,httpStatus:status,result:'not_accepted',retryAfter:response.headers.get('retry-after')||null,indexingVerified:false,message:status===429?'更新通知が制限されています。Retry-After を確認し、連続送信しないでください。':'更新通知は成功していません。HTTP 結果を確認してください。'};
    },timeoutMs);
  }catch(error){
    return{ok:false,mode,...summary,stage,notificationAttempted:attempted,accepted:attempted?null:false,indexingVerified:false,result:attempted?'unconfirmed':'not_sent',code:error.code||'NETWORK_OR_FILE_ERROR',...(error.details||{}),message:error instanceof NoticeError?error.message:stage==='local'?'ローカル設定または公開ファイルを読み取れません。':attempted?'通知の応答を確認できません。受理されたかは不明です。':'公開確認を完了できなかったため、通知していません。'};
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=await run({argv:process.argv.slice(2)});
  process.stdout.write(result.mode==='help'?result.message+'\n':JSON.stringify(result,null,2)+'\n');
  process.exitCode=result.ok?0:1;
}
