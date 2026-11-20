/* Validate the released crawlable surface, not just generated strings. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..'),origin='https://www.kasai-solutions-inc.com';
const sitemap=fs.readFileSync(path.join(root,'sitemap.xml'),'utf8');
const urls=[...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>m[1]);
assert.equal(urls.length,4);assert.equal(new Set(urls).size,4);
assert.equal(fs.readFileSync(path.join(root,'CNAME'),'utf8').trim(),new URL(origin).hostname);
const titles=new Set(),descriptions=new Set();let links=0,graphs=0;
function tagAttrs(tag){return Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)].map(m=>[m[1],m[3]]));}
for(const url of urls){
 const parsed=new URL(url);assert.equal(parsed.origin,origin);assert(!parsed.hash&&!parsed.search);
 const file=path.join(root,parsed.pathname,'index.html');assert(fs.existsSync(file),'Sitemap target is missing: '+url);
 const html=fs.readFileSync(file,'utf8');assert(/<html[^>]*lang=["']ja["']/.test(html));
 const title=html.match(/<title>([^<]+)<\/title>/)?.[1];assert(title?.length>=8);assert(!titles.has(title));titles.add(title);
 const meta=[...html.matchAll(/<meta\b[^>]*>/gi)].map(m=>tagAttrs(m[0]));
 const description=meta.find(m=>m.name==='description')?.content;assert(description?.length>=40);assert(!descriptions.has(description));descriptions.add(description);
 const canonicals=[...html.matchAll(/<link\b[^>]*>/gi)].map(m=>tagAttrs(m[0])).filter(a=>a.rel==='canonical');assert.equal(canonicals.length,1);assert.equal(canonicals[0].href,url);
 assert.equal(meta.find(m=>m.property==='og:url')?.content,url);assert.equal(meta.find(m=>m.property==='og:locale')?.content,'ja_JP');
 assert(meta.find(m=>m.property==='og:image')?.content.startsWith(origin+'/'));assert.equal(meta.find(m=>m.name==='twitter:card')?.content,'summary_large_image');
 assert(!meta.find(m=>m.name==='robots')?.content.includes('noindex'));
 assert(/<h1\b/.test(html));assert(html.includes('KASAI SOLUTIONS'));
 const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];let pageGraphs=0;
 for(const match of scripts){const attrs=tagAttrs(match[1]);if(attrs.type!=='application/ld+json')continue;const data=JSON.parse(match[2]);assert.equal(data['@context'],'https://schema.org');graphs++;pageGraphs++;assert(!match[2].includes('aggregateRating'),'Do not publish unsupported ratings');}
 assert(pageGraphs>0,'Missing structured data on '+url);
 for(const match of html.matchAll(/<(?:a|img|script|link)\b[^>]*>/gi)){
  const attrs=tagAttrs(match[0]),href=attrs.href||attrs.src;if(!href||/^(?:data:|mailto:|tel:|javascript:)/.test(href))continue;
  const target=new URL(href,url);if(target.origin!==origin)continue;
  let targetFile=path.join(root,decodeURIComponent(target.pathname));if(target.pathname.endsWith('/'))targetFile=path.join(targetFile,'index.html');
  assert(fs.existsSync(targetFile),'Broken public link/asset: '+href+' on '+url);links++;
 }
 if(parsed.pathname!=='/'){assert(html.replace(/<script[\s\S]*?<\/script>/gi,'').length>3000,'Guide must contain useful static content');assert(/<h2\b/.test(html));}
}
const robots=fs.readFileSync(path.join(root,'robots.txt'),'utf8');assert(robots.includes('Sitemap: '+origin+'/sitemap.xml'));assert(!/^Disallow:\s*\/\s*$/m.test(robots));
const notFound=fs.readFileSync(path.join(root,'404.html'),'utf8');assert(/content="noindex,follow"/.test(notFound));
console.log(`PASS ${urls.length} canonical pages, ${graphs} JSON-LD blocks, ${links} local links/assets, sitemap, robots, domain and 404.`);
