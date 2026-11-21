/* Validate the released crawlable surface, not just generated strings. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..'),origin='https://www.kasai-solutions-inc.com';
const sitemap=fs.readFileSync(path.join(root,'sitemap.xml'),'utf8');
const urls=[...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>m[1]);
assert.equal(urls.length,4);assert.equal(new Set(urls).size,4);
assert.equal(fs.readFileSync(path.join(root,'CNAME'),'utf8').trim(),new URL(origin).hostname);
const titles=new Set(),descriptions=new Set(),connections=new Map(),renderAssets=new Set();let links=0,graphs=0;
function decode(value){return value.replace(/&(?:amp|lt|gt|quot|#39);/g,entity=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"}[entity]));}
function tagAttrs(tag){return Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)].map(m=>[m[1].toLowerCase(),decode(m[3])]));}
for(const url of urls){
 const parsed=new URL(url);assert.equal(parsed.origin,origin);assert(!parsed.hash&&!parsed.search);
 const file=path.join(root,parsed.pathname,'index.html');assert(fs.existsSync(file),'Sitemap target is missing: '+url);
 const html=fs.readFileSync(file,'utf8');assert(/<html[^>]*lang=["']ja["']/.test(html));
 const pageTitles=[...html.matchAll(/<title>([^<]+)<\/title>/g)];assert.equal(pageTitles.length,1,'Exactly one title: '+url);const title=decode(pageTitles[0][1]);assert(title.length>=8);assert(!titles.has(title));titles.add(title);
 const meta=[...html.matchAll(/<meta\b[^>]*>/gi)].map(m=>tagAttrs(m[0]));
 const pageDescriptions=meta.filter(m=>m.name==='description');assert.equal(pageDescriptions.length,1,'Exactly one description: '+url);const description=pageDescriptions[0].content;assert(description?.length>=40);assert(!descriptions.has(description));descriptions.add(description);
 const canonicals=[...html.matchAll(/<link\b[^>]*>/gi)].map(m=>tagAttrs(m[0])).filter(a=>a.rel==='canonical');assert.equal(canonicals.length,1);assert.equal(canonicals[0].href,url);
 assert.equal(meta.find(m=>m.property==='og:url')?.content,url);assert.equal(meta.find(m=>m.property==='og:locale')?.content,'ja_JP');
 assert(meta.find(m=>m.property==='og:image')?.content.startsWith(origin+'/'));assert.equal(meta.find(m=>m.name==='twitter:card')?.content,'summary_large_image');
 const indexing=meta.filter(m=>['robots','googlebot','bingbot'].includes(m.name?.toLowerCase()));assert(indexing.some(m=>m.name==='robots'),'Missing robots metadata: '+url);assert(indexing.every(m=>!/(?:^|[\s,])(?:noindex|none)(?:[\s,]|$)/i.test(m.content||'')),'Page is excluded from indexing: '+url);
 assert.equal([...html.matchAll(/<h1\b/gi)].length,1,'One primary heading: '+url);assert(html.includes('KASAI SOLUTIONS'));connections.set(url,new Set());
 const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];let pageGraphs=0;
 for(const match of scripts){const attrs=tagAttrs(match[1]);if(attrs.type!=='application/ld+json')continue;const data=JSON.parse(match[2]);assert.equal(data['@context'],'https://schema.org');graphs++;pageGraphs++;assert(!match[2].includes('aggregateRating'),'Do not publish unsupported ratings');}
 assert(pageGraphs>0,'Missing structured data on '+url);
 for(const match of html.matchAll(/<(?:a|img|script|link)\b[^>]*>/gi)){
  const attrs=tagAttrs(match[0]),href=attrs.href||attrs.src;if(!href||/^(?:data:|mailto:|tel:|javascript:)/.test(href))continue;
  const target=new URL(href,url);if(target.origin!==origin)continue;
  let targetFile=path.join(root,decodeURIComponent(target.pathname));if(target.pathname.endsWith('/'))targetFile=path.join(targetFile,'index.html');
  assert(fs.existsSync(targetFile),'Broken public link/asset: '+href+' on '+url);links++;
  if(/^<a\b/i.test(match[0])&&urls.includes(target.origin+target.pathname))connections.get(url).add(target.origin+target.pathname);
  if(/^<(?:img|script|link)\b/i.test(match[0]))renderAssets.add(target.pathname);
  if(target.hash&&parsed.pathname!=='/'&&/^<a\b/i.test(match[0])&&urls.includes(target.origin+target.pathname)){
   const linked=fs.readFileSync(targetFile,'utf8'),id=decodeURIComponent(target.hash.slice(1));assert([...linked.matchAll(/\bid=["']([^"']+)["']/g)].some(m=>m[1]===id),'Broken public section: '+href+' on '+url);
  }
 }
 if(parsed.pathname!=='/'){const text=html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi,'').replace(/<[^>]+>/g,'').replace(/\s+/g,'');assert(text.length>400,'Guide must contain useful text without JavaScript');assert(/<h2\b/.test(html));}
}
const robots=fs.readFileSync(path.join(root,'robots.txt'),'utf8');assert(robots.includes('Sitemap: '+origin+'/sitemap.xml'));assert(!/^Disallow:\s*\/\s*$/m.test(robots));
// Evaluate the groups used by the two search crawlers, including path-specific
// exclusions. An otherwise-valid guide must not be blocked by a narrower rule.
const groups=[];let group=null;
for(const raw of robots.split(/\r?\n/)){const match=raw.replace(/#.*/,'').trim().match(/^([\w-]+):\s*(.*)$/);if(!match)continue;const field=match[1].toLowerCase(),value=match[2];if(field==='user-agent'){if(!group||group.rules.length){group={agents:[],rules:[]};groups.push(group);}group.agents.push(value.toLowerCase());}else if(group&&['allow','disallow'].includes(field)&&value)group.rules.push({allow:field==='allow',value});}
for(const agent of ['googlebot','bingbot']){
 const explicit=groups.filter(g=>g.agents.includes(agent)),selected=explicit.length?explicit:groups.filter(g=>g.agents.includes('*'));
 for(const pathname of [...urls.map(url=>new URL(url).pathname),...renderAssets]){
  const matches=selected.flatMap(g=>g.rules).filter(rule=>{const pattern=rule.value.split('*').map(part=>part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*').replace(/\\\$$/,'$');return new RegExp('^'+pattern).test(pathname);}).sort((a,b)=>b.value.replace(/\*/g,'').length-a.value.replace(/\*/g,'').length||Number(b.allow)-Number(a.allow));
  assert(!matches.length||matches[0].allow,agent+' cannot crawl '+pathname);
 }
}
const seen=new Set(),pending=[origin+'/'];for(let i=0;i<pending.length;i++){const url=pending[i];if(seen.has(url))continue;seen.add(url);pending.push(...connections.get(url)||[]);}assert.equal(seen.size,4,'All sitemap pages need static links from the public site');
const notFound=fs.readFileSync(path.join(root,'404.html'),'utf8');assert(/content="noindex,follow"/.test(notFound));
console.log(`PASS ${urls.length} canonical pages, ${graphs} JSON-LD blocks, ${links} local links/assets, static discovery, section links, crawler access, sitemap, domain and 404.`);
