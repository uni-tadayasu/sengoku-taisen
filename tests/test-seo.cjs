'use strict';
// Static publication contracts plus a fully mocked IndexNow transport. These
// tests never notify a search engine or change the released HTML/configuration.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),site=JSON.parse(fs.readFileSync(path.join(root,'site-metadata.json'),'utf8'));
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const decode=text=>text.replace(/&(?:amp|lt|gt|quot|#39);/g,m=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"}[m]));
const attrs=tag=>Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)].map(m=>[m[1].toLowerCase(),decode(m[3])]));
const tags=(html,name)=>[...html.matchAll(new RegExp('<'+name+'\\b[^>]*>','gi'))].map(m=>attrs(m[0]));
const normalized=text=>decode(text.replace(/<[^>]+>/g,'')).replace(/\s+/g,'');
const htmlFor=page=>read(path.join(page.path,'index.html').replace(/^\//,''));
const pages=Object.entries(site.pages).map(([key,page])=>({key,...page,url:site.origin+page.path,html:htmlFor(page)}));
const graph=html=>JSON.parse([...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].find(m=>attrs(m[1]).type==='application/ld+json')[2])['@graph'];
const tests=[];const test=(name,fn)=>tests.push([name,fn]);

test('one metadata source matches every title, description, canonical and social preview',()=>{
  assert.equal(site.schemaVersion,1);assert.equal(site.origin,'https://www.kasai-solutions-inc.com');assert.deepEqual(Object.keys(site.pages).sort(),['about','guide','home','recovery']);
  for(const page of pages){
    const meta=tags(page.html,'meta'),links=tags(page.html,'link'),value=(kind,key)=>{const matches=meta.filter(m=>m[kind]===key);assert.equal(matches.length,1,key+' on '+page.path);return matches[0].content;};
    assert.equal(decode(page.html.match(/<title>([^<]+)<\/title>/)[1]),page.title);assert.equal(value('name','description'),page.description);
    assert.equal(links.find(l=>l.rel==='canonical').href,page.url);
    for(const [name,expected] of [['og:title',page.title],['og:description',page.description],['og:url',page.url],['og:site_name',site.name],['og:locale',site.locale],['og:image',site.origin+'/'+site.ogImage.path],['og:image:width',String(site.ogImage.width)],['og:image:height',String(site.ogImage.height)],['og:image:alt',site.ogImage.alt]])assert.equal(value('property',name),expected,name);
    for(const [name,expected] of [['twitter:title',page.title],['twitter:description',page.description],['twitter:image',site.origin+'/'+site.ogImage.path],['twitter:image:alt',site.ogImage.alt]])assert.equal(value('name',name),expected,name);
  }
});

test('all four JSON-LD graphs share one publisher, site and game identity with truthful page metadata',()=>{
  const home=site.origin+'/',commonIds={Organization:home+'#organization',WebSite:home+'#website',VideoGame:home+'#game'};
  for(const page of pages){
    const nodes=graph(page.html),ids=nodes.map(node=>node['@id']);assert.equal(new Set(ids).size,ids.length);
    for(const [type,id] of Object.entries(commonIds))assert.equal(nodes.find(node=>node['@type']===type)?.['@id'],id);
    const organization=nodes.find(n=>n['@type']==='Organization'),website=nodes.find(n=>n['@type']==='WebSite'),game=nodes.find(n=>n['@type']==='VideoGame'),webpage=nodes.find(n=>n['@type']==='WebPage');
    assert.equal(organization.name,site.publisher);assert.equal(organization.logo.url,site.origin+'/'+site.logo.path);assert.equal(organization.logo.width,site.logo.width);assert.equal(organization.logo.height,site.logo.height);
    assert.equal(website.name,site.name);assert.equal(website.alternateName,site.alternateName);assert.equal(website.publisher['@id'],commonIds.Organization);
    assert.equal(game.name,site.name);assert.equal(game.description,site.pages.home.description);assert.equal(game.softwareVersion,site.version);assert.equal(game.dateModified,site.dateModified);assert.equal(game.publisher['@id'],commonIds.Organization);assert.equal(game.softwareHelp.url,site.origin+site.pages.guide.path);
    assert.equal(webpage.url,page.url);assert.equal(webpage['@id'],page.url+'#webpage');assert.equal(webpage.name,page.title);assert.equal(webpage.description,page.description);assert.equal(webpage.dateModified,page.dateModified);assert.equal(webpage.inLanguage,site.language);assert.equal(webpage.isPartOf['@id'],commonIds.WebSite);assert.equal(webpage.publisher['@id'],commonIds.Organization);assert.equal(webpage.about['@id'],commonIds.VideoGame);if(['home','about'].includes(page.key))assert.equal(webpage.mainEntity['@id'],commonIds.VideoGame);
    const serialized=JSON.stringify(nodes);assert(!/"(?:aggregateRating|review|award|SearchAction)"/.test(serialized),'Do not claim unavailable reviews, awards or search functionality');
  }
});

test('reading-page breadcrumb markup matches visible labels and actual canonical ancestors',()=>{
  for(const page of pages.filter(p=>p.key!=='home')){
    const breadcrumb=graph(page.html).find(n=>n['@type']==='BreadcrumbList'),items=breadcrumb.itemListElement;
    const expected=page.key==='recovery'?[site.origin+'/',site.origin+site.pages.guide.path,page.url]:[site.origin+'/',page.url];
    assert.deepEqual(items.map(item=>item.item),expected);assert.deepEqual(items.map(item=>item.position),items.map((_,i)=>i+1));
    const visible=page.html.match(/<ol\b[^>]*class="breadcrumbs"[^>]*>([\s\S]*?)<\/ol>/)?.[1];assert(visible,'Visible breadcrumbs are required');
    const labels=[...visible.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m=>normalized(m[1]));assert.deepEqual(labels,items.map(item=>normalized(item.name)));
    assert(page.html.includes(`datetime="${page.dateModified}"`));
  }
});

test('sitemap dates, install metadata and stable square favicon reflect the same public site',()=>{
  const sitemap=read('sitemap.xml'),entries=[...sitemap.matchAll(/<url><loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod><\/url>/g)];
  assert.equal(entries.length,4);for(const page of pages)assert(entries.some(e=>e[1]===page.url&&e[2]===page.dateModified));
  const manifest=JSON.parse(read('manifest.webmanifest'));assert.equal(manifest.description,site.pages.home.description);assert.equal(manifest.short_name,site.name);assert.equal(manifest.lang,site.language);assert.equal(new URL(manifest.start_url,site.origin+'/').href,site.origin+'/');assert.equal(new URL(manifest.scope,site.origin+'/').href,site.origin+'/');
  const png=fs.readFileSync(path.join(root,site.favicon.path));assert.equal(png.subarray(1,4).toString(),'PNG');assert.equal(png.readUInt32BE(16),192);assert.equal(png.readUInt32BE(20),192);
  for(const page of pages){const icon=tags(page.html,'link').find(link=>link.rel==='icon'&&link.sizes===site.favicon.sizes);assert(icon,'192px favicon on '+page.path);const url=new URL(icon.href,page.url);assert.equal(url.href,site.origin+'/'+site.favicon.path);assert(!url.search&&!url.hash);assert.equal(icon.type,site.favicon.type);}
});

test('the home introduction is visible HTML and still preserves the existing game entry',()=>{
  const html=pages.find(p=>p.key==='home').html,intro=html.match(/<p\b[^>]*class="launch-introduction"[^>]*>([\s\S]*?)<\/p>/)?.[1];
  assert(intro);assert.equal(normalized(intro),normalized(site.launchIntroduction.join('')));assert.equal([...html.matchAll(/\bid="launch-enter"/g)].length,1);assert(html.includes('id="main"'));assert(html.includes('id="launch-screen"'));
});

(async()=>{
 const notifier=await import(pathToFileURL(path.join(root,'tools/notify-indexnow.mjs')).href),plan=await notifier.loadPlan(root);
 const response=(body,status=200,type='text/html; charset=utf-8',headers={})=>new Response(body,{status,headers:{'Content-Type':type,...headers}});
 function mock(override){
  const calls=[];const fetchImpl=async(url,options)=>{
   calls.push({url,method:options.method,options});assert.equal(options.redirect,'error');assert(options.signal instanceof AbortSignal);
   const changed=await override?.(url,options,calls);if(changed!==undefined)return changed;
   if(options.method==='POST'){assert.equal(url,notifier.ENDPOINT);return response('',200,'application/json');}
   assert.equal(options.method,'GET');assert.equal(new URL(url).origin,site.origin);
   if(url===plan.payload.keyLocation)return response(plan.payload.key+'\n',200,'text/plain');
   if(url===site.origin+'/sitemap.xml')return response(read('sitemap.xml'),200,'application/xml');
   const page=pages.find(page=>page.url===url);assert(page,'Unexpected preflight URL '+url);return response(page.html);
  };
  return{calls,fetchImpl,posts:()=>calls.filter(call=>call.method==='POST')};
 }
 function fixture(change){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sengoku-seo-'));
  fs.mkdirSync(path.join(dir,'tools'));fs.copyFileSync(path.join(root,'tools/indexnow-config.json'),path.join(dir,'tools/indexnow-config.json'));fs.copyFileSync(path.join(root,plan.keyFile),path.join(dir,plan.keyFile));fs.copyFileSync(path.join(root,'sitemap.xml'),path.join(dir,'sitemap.xml'));
  change(dir);return dir;
 }

 test('default dry run reads existing files without network, key rotation or payload logging',async()=>{
  const before=read('tools/indexnow-config.json'),keyBefore=read(plan.keyFile);let calls=0;
  const result=await notifier.run({root,fetchImpl:()=>{calls++;throw Error('Network must not run');}});
  assert(result.ok);assert.equal(result.mode,'dry-run');assert.equal(result.networkRequests,0);assert.equal(result.notificationAttempted,false);assert.equal(result.urlCount,4);assert.equal(result.accepted,false);assert.equal(result.indexingVerified,false);assert.equal(calls,0);assert(!Object.hasOwn(result,'key'));assert(!Object.hasOwn(result,'payload'));assert.equal(read('tools/indexnow-config.json'),before);assert.equal(read(plan.keyFile),keyBefore);
 });
 test('CLI rejects arbitrary endpoints/URLs and incompatible local key configuration before any request',async()=>{
  for(const argv of [['--url','https://other.invalid/'],['https://other.invalid/'],['--submit','--host=other.invalid'],['--submit','--submit']]){const result=await notifier.run({argv,root,fetchImpl:()=>assert.fail('must not fetch')});assert.equal(result.ok,false);assert.equal(result.code,'INVALID_ARGUMENT');}
  for(const change of [dir=>{const file=path.join(dir,'tools/indexnow-config.json'),c=JSON.parse(fs.readFileSync(file));c.host='other.invalid';fs.writeFileSync(file,JSON.stringify(c));},dir=>fs.writeFileSync(path.join(dir,plan.keyFile),'not-the-key')]){
   const dir=fixture(change);try{const result=await notifier.run({argv:['--submit'],root:dir,fetchImpl:()=>assert.fail('must not fetch')});assert.equal(result.ok,false);assert.equal(result.notificationAttempted,false);}finally{fs.rmSync(dir,{recursive:true,force:true});}
  }
 });
 test('only the four same-host canonical sitemap URLs and valid dates can become a notification',()=>{
  const xml=read('sitemap.xml');assert.deepEqual(notifier.parseSitemap(xml),notifier.URLS);
  for(const bad of [xml.replace(site.origin,'https://other.invalid'),xml.replace(site.origin+'/guide/',site.origin+'/guide/?tracking=1'),xml.replace(site.origin+'/about/',site.origin+'/guide/'),xml.replace('<urlset','<!DOCTYPE urlset><urlset'),xml.replace(/<lastmod>[^<]+<\/lastmod>/,'<lastmod>2026-02-30</lastmod>'),xml.replace('<urlset','<sitemapindex')])assert.throws(()=>notifier.parseSitemap(bad));
 });
 test('submit waits for every published check, then sends exactly one bounded four-URL POST',async()=>{
  let releasePage,seenPage;const seen=new Promise(resolve=>{seenPage=resolve;});
  const transport=mock((url,options)=>{if(options.method==='GET'&&url===site.origin+'/about/'){seenPage();return new Promise(resolve=>{releasePage=()=>resolve(response(pages.find(page=>page.key==='about').html));});}});
  const pending=notifier.run({argv:['--submit'],root,fetchImpl:transport.fetchImpl});await seen;assert.equal(transport.posts().length,0);releasePage();const result=await pending;
  assert(result.ok);assert.equal(result.result,'received');assert.equal(result.accepted,true);assert.equal(result.keyValidationPending,false);assert.equal(result.indexingVerified,false);assert.equal(result.pagesVerified,4);assert.equal(transport.posts().length,1);assert.equal(transport.calls.length,7);
  const post=transport.posts()[0];assert.equal(transport.calls.at(-1),post);assert.deepEqual(JSON.parse(post.options.body),plan.payload);assert.equal(post.options.headers['Content-Type'],'application/json; charset=utf-8');
 });
 test('202 is reported as key validation pending rather than confirmed 200 or indexing',async()=>{
  const transport=mock((url,options)=>options.method==='POST'?response('',202,'application/json'):undefined),result=await notifier.run({argv:['--submit'],root,fetchImpl:transport.fetchImpl});assert(result.ok);assert.equal(result.httpStatus,202);assert.equal(result.result,'received_key_pending');assert.equal(result.keyValidationPending,true);assert.equal(result.indexingVerified,false);assert.equal(transport.posts().length,1);
 });
 test('missing/mismatched public key or changed sitemap stops before any POST',async()=>{
  for(const alteration of ['missing','mismatch','sitemap']){
   const transport=mock(url=>url===plan.payload.keyLocation&&alteration!=='sitemap'?response(alteration==='missing'?'missing':'wrong key',alteration==='missing'?404:200,'text/plain'):url===site.origin+'/sitemap.xml'&&alteration==='sitemap'?response(read('sitemap.xml').replace(site.origin+'/about/',site.origin+'/private/'),200,'application/xml'):undefined);
   const result=await notifier.run({argv:['--submit'],root,fetchImpl:transport.fetchImpl});assert.equal(result.ok,false);assert.equal(result.notificationAttempted,false);assert.equal(transport.posts().length,0);
  }
 });
 test('non-200, noindex, wrong canonical, non-HTML and redirected pages never get notified',async()=>{
  const page=pages.find(page=>page.key==='guide');
  for(const kind of ['404','meta-noindex','header-noindex','canonical','not-html','redirect']){
   const transport=mock(url=>{
    if(url!==page.url)return;
    if(kind==='404')return response('missing',404);
    if(kind==='meta-noindex')return response(page.html.replace('content="index,follow','content="noindex,follow'));
    if(kind==='header-noindex')return response(page.html,200,'text/html',{'X-Robots-Tag':'noindex'});
    if(kind==='canonical')return response(page.html.replace(`rel="canonical" href="${page.url}"`,`rel="canonical" href="${site.origin}/"`));
    if(kind==='not-html')return response(page.html,200,'application/json');
    const r=response(page.html);Object.defineProperty(r,'redirected',{value:true});return r;
   });
   const result=await notifier.run({argv:['--submit'],root,fetchImpl:transport.fetchImpl});assert.equal(result.ok,false,kind);assert.equal(result.notificationAttempted,false,kind);assert.equal(transport.posts().length,0,kind);
  }
 });
 test('429 and other rejection statuses are non-success, retain Retry-After and never retry',async()=>{
  for(const status of [400,403,422,429,500]){
   const transport=mock((url,options)=>options.method==='POST'?response('',status,'text/plain',status===429?{'Retry-After':'120'}:{}):undefined),result=await notifier.run({argv:['--submit'],root,fetchImpl:transport.fetchImpl});
   assert.equal(result.ok,false);assert.equal(result.accepted,false);assert.equal(result.httpStatus,status);assert.equal(result.result,'not_accepted');assert.equal(transport.posts().length,1);if(status===429)assert.equal(result.retryAfter,'120');
  }
 });
 test('network loss and timeouts distinguish unattempted preflight from uncertain POST receipt',async()=>{
  const failedPreflight=mock(()=>{throw Error('network failure');}),early=await notifier.run({argv:['--submit'],root,fetchImpl:failedPreflight.fetchImpl});assert.equal(early.ok,false);assert.equal(early.result,'not_sent');assert.equal(early.notificationAttempted,false);assert.equal(failedPreflight.posts().length,0);
  const lostReply=mock((url,options)=>{if(options.method==='POST')throw Error('response lost');}),late=await notifier.run({argv:['--submit'],root,fetchImpl:lostReply.fetchImpl});assert.equal(late.ok,false);assert.equal(late.result,'unconfirmed');assert.equal(late.accepted,null);assert.equal(lostReply.posts().length,1);
  for(const stage of ['preflight','notification']){
   let signal;const transport=mock((url,options)=>{if(stage==='preflight'||options.method==='POST'){signal=options.signal;return new Promise(()=>{});}}),result=await notifier.run({argv:['--submit'],root,fetchImpl:transport.fetchImpl,timeoutMs:10});
   assert.equal(result.ok,false);assert.equal(result.code,'TIMEOUT');assert.equal(signal.aborted,true);assert.equal(transport.posts().length,stage==='preflight'?0:1);assert.equal(result.accepted,stage==='preflight'?false:null);
  }
 });
 for(const [name,fn] of tests){await fn();console.log('PASS '+name);}
 console.log(JSON.stringify({passed:tests.length,realIndexNowNotifications:0,mockTransportOnly:true}));
})().catch(error=>{console.error(error);process.exitCode=1;});
