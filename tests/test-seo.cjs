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
const bytes=file=>fs.readFileSync(path.join(root,file));
function pngSize(image){
  assert(image.length>=24,'PNG header is missing');
  assert(image.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'The icon must contain a real PNG');
  assert.equal(image.subarray(12,16).toString(),'IHDR');
  return{width:image.readUInt32BE(16),height:image.readUInt32BE(20)};
}
function assertOpaquePng(image){
  const {width,height}=pngSize(image),chunks=[];
  for(let offset=8;offset+12<=image.length;){
    const length=image.readUInt32BE(offset),type=image.subarray(offset+4,offset+8).toString();
    assert(offset+12+length<=image.length,'Truncated PNG chunk');
    chunks.push({type,data:image.subarray(offset+8,offset+8+length)});offset+=length+12;
  }
  assert(!chunks.some(chunk=>chunk.type==='tRNS'),'Maskable icons must have an opaque background');
  const header=chunks.find(chunk=>chunk.type==='IHDR').data;
  assert.equal(header[8],8,'Maskable icons use an 8-bit PNG');
  assert([2,6].includes(header[9]),'Maskable icons use RGB or RGBA');
  assert.equal(header[12],0,'Maskable PNGs are not interlaced');
  if(header[9]===2)return;
  const raw=require('node:zlib').inflateSync(Buffer.concat(chunks.filter(chunk=>chunk.type==='IDAT').map(chunk=>chunk.data)));
  const stride=width*4;assert.equal(raw.length,(stride+1)*height);
  let previous=Buffer.alloc(stride);
  for(let y=0;y<height;y++){
    const offset=y*(stride+1),filter=raw[offset],row=Buffer.alloc(stride);assert(filter<=4,'Invalid PNG row filter');
    for(let x=0;x<stride;x++){
      const left=x>=4?row[x-4]:0,up=previous[x],upperLeft=x>=4?previous[x-4]:0;
      const prediction=left+up-upperLeft,distances=[Math.abs(prediction-left),Math.abs(prediction-up),Math.abs(prediction-upperLeft)];
      const paeth=distances[0]<=distances[1]&&distances[0]<=distances[2]?left:distances[1]<=distances[2]?up:upperLeft;
      const predictor=[0,left,up,Math.floor((left+up)/2),paeth][filter];
      row[x]=(raw[offset+x+1]+predictor)&255;
    }
    for(let x=3;x<stride;x+=4)assert.equal(row[x],255,'Maskable icons must not contain transparent pixels');
    previous=row;
  }
}
function assertSelfContainedSvg(file){
  const svg=read(file),rootTag=svg.match(/<svg\b[^>]*>/i)?.[0];assert(rootTag,'An SVG root is required');
  const rootAttrs=attrs(rootTag);assert.equal(rootAttrs.xmlns,'http://www.w3.org/2000/svg');
  const box=(rootAttrs.viewbox||'').trim().split(/[\s,]+/).map(Number);
  assert.equal(box.length,4);assert(box.every(Number.isFinite)&&box[2]>0&&box[2]===box[3],'Brand SVGs must have a square viewBox');
  assert(!/<(?:script|foreignObject|iframe|image|text)\b/i.test(svg),'Brand SVGs must use self-contained vector geometry');
  assert(!/\bon[a-z]+\s*=|<!DOCTYPE|<!ENTITY|<\?xml-stylesheet|@import/i.test(svg),'Brand SVGs must not execute or import content');
  for(const tag of svg.matchAll(/<[^!?/][^>]*>/g))for(const [name,value] of Object.entries(attrs(tag[0])))if(name==='href'||name==='xlink:href')assert(value.startsWith('#'),'SVG references must remain inside the same file');
  for(const match of svg.matchAll(/url\(\s*["']?([^\s)'";]+)/gi))assert(match[1].startsWith('#'),'SVG paint must not request external content');
}
function jpegSize(image){
  assert(image.length>=4&&image.readUInt16BE(0)===0xffd8,'The social image must contain a real JPEG');
  let offset=2;
  while(offset+3<image.length){
    assert.equal(image[offset++],0xff,'Invalid JPEG marker');
    while(image[offset]===0xff)offset++;
    const marker=image[offset++];
    if(marker===0xd9||marker===0xda)break;
    if(marker===0x01||marker>=0xd0&&marker<=0xd7)continue;
    const length=image.readUInt16BE(offset);
    assert(length>=2&&offset+length<=image.length,'Truncated JPEG segment');
    if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){
      assert(length>=8,'Invalid JPEG frame');
      return{width:image.readUInt16BE(offset+5),height:image.readUInt16BE(offset+3)};
    }
    offset+=length;
  }
  assert.fail('The social image has no JPEG dimensions');
}

test('one metadata source matches every title, description, canonical and social preview',()=>{
  assert.equal(site.schemaVersion,1);assert.equal(site.origin,'https://www.kasai-solutions-inc.com');assert.deepEqual(Object.keys(site.pages).sort(),['about','guide','home','premium','press','recovery','share']);assert.equal(site.pages.home.path,'/');assert.equal(site.pages.share.path,'/sengoku-vs/');assert.equal(site.pages.premium.path,'/premium/');
  for(const page of pages){
    const image = page.socialImage || site.ogImage;
    const meta=tags(page.html,'meta'),links=tags(page.html,'link'),value=(kind,key)=>{const matches=meta.filter(m=>m[kind]===key);assert.equal(matches.length,1,key+' on '+page.path);return matches[0].content;};
    assert.equal(decode(page.html.match(/<title>([^<]+)<\/title>/)[1]),page.title);assert.equal(value('name','description'),page.description);
    assert.equal(links.find(l=>l.rel==='canonical').href,page.url);
    for(const [name,expected] of [['og:title',page.title],['og:description',page.description],['og:url',page.url],['og:site_name',site.name],['og:locale',site.locale],['og:image',site.origin+'/'+image.path],['og:image:secure_url',site.origin+'/'+image.path],['og:image:type',image.type],['og:image:width',String(image.width)],['og:image:height',String(image.height)],['og:image:alt',image.alt]])assert.equal(value('property',name),expected,name);
    for(const [name,expected] of [['twitter:card','summary_large_image'],['twitter:title',page.title],['twitter:description',page.description],['twitter:image',site.origin+'/'+image.path],['twitter:image:alt',image.alt]])assert.equal(value('name',name),expected,name);
    assert.deepEqual(jpegSize(bytes(image.path)), { width: image.width, height: image.height });
    assert(bytes(image.path).length<1024*1024,'Social previews stay below the project 1 MiB image budget');
  }
});

test('all public JSON-LD graphs share one publisher, site and game identity with truthful page metadata',()=>{
  const home=site.origin+'/',commonIds={Organization:home+'#organization',WebSite:home+'#website',VideoGame:home+'#game'};
  for(const page of pages){
    const nodes=graph(page.html),ids=nodes.map(node=>node['@id']);assert.equal(new Set(ids).size,ids.length);
    for(const [type,id] of Object.entries(commonIds))assert.equal(nodes.find(node=>node['@type']===type)?.['@id'],id);
    const organization=nodes.find(n=>n['@type']==='Organization'),website=nodes.find(n=>n['@type']==='WebSite'),game=nodes.find(n=>n['@type']==='VideoGame'),webpage=nodes.find(n=>n['@type']==='WebPage');
    assert.equal(organization.name,site.publisher);assert.equal(organization.logo.url,site.origin+'/'+site.logo.path);assert.equal(organization.logo.width,site.logo.width);assert.equal(organization.logo.height,site.logo.height);
    assert.equal(website.name,site.name);assert.equal(website.alternateName,site.alternateName);assert.equal(website.publisher['@id'],commonIds.Organization);
    assert.equal(game.url,home);assert.equal(game.name,site.name);assert.equal(game.description,site.pages.home.description);assert.equal(game.image,site.origin+'/'+site.ogImage.path);assert.equal(game.softwareVersion,site.version);assert.equal(game.dateModified,site.dateModified);assert.equal(game.publisher['@id'],commonIds.Organization);assert.equal(game.softwareHelp.url,site.origin+site.pages.guide.path);
    assert.equal(webpage.url,page.url);assert.equal(webpage['@id'],page.url+'#webpage');assert.equal(webpage.name,page.title);assert.equal(webpage.description,page.description);assert.equal(webpage.dateModified,page.dateModified);assert.equal(webpage.inLanguage,site.language);assert.equal(webpage.isPartOf['@id'],commonIds.WebSite);assert.equal(webpage.publisher['@id'],commonIds.Organization);assert.equal(webpage.about['@id'],commonIds.VideoGame);if(['home','share','about'].includes(page.key))assert.equal(webpage.mainEntity['@id'],commonIds.VideoGame);
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
  assert.equal(entries.length,pages.length);for(const page of pages)assert(entries.some(e=>e[1]===page.url&&e[2]===page.dateModified));
  const manifest=JSON.parse(read('manifest.webmanifest'));assert.equal(manifest.description,site.pages.home.description);assert.equal(manifest.short_name,site.name);assert.equal(manifest.lang,site.language);assert.equal(new URL(manifest.start_url,site.origin+'/').href,site.origin+'/');assert.equal(new URL(manifest.scope,site.origin+'/').href,site.origin+'/');
  const png=fs.readFileSync(path.join(root,site.favicon.path));assert.equal(png.subarray(1,4).toString(),'PNG');assert.equal(png.readUInt32BE(16),192);assert.equal(png.readUInt32BE(20),192);
  for(const page of pages){const icon=tags(page.html,'link').find(link=>link.rel==='icon'&&link.sizes===site.favicon.sizes);assert(icon,'192px favicon on '+page.path);const url=new URL(icon.href,page.url);assert.equal(url.href,site.origin+'/'+site.favicon.path);assert(!url.search&&!url.hash);assert.equal(icon.type,site.favicon.type);}
});

test('image sitemap sends crawlers to visible artwork on each canonical page',()=>{
  const xml=read('image-sitemap.xml');
  assert(xml.includes('xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"'));
  assert(read('robots.txt').includes('Sitemap: '+site.origin+'/image-sitemap.xml'));
  const entries=[...xml.matchAll(/<url><loc>([^<]+)<\/loc>([\s\S]*?)<\/url>/g)];
  assert.equal(entries.length,pages.length);
  for(const page of pages){
    const entry=entries.find(match=>match[1]===page.url);
    assert(entry,page.url);
    const links=[...entry[2].matchAll(/<image:loc>([^<]+)<\/image:loc>/g)].map(match=>match[1]);
    const expected=[page.artwork.path,...(page.additionalImages||[])].map(file=>site.origin+'/'+file);
    assert.deepEqual(links,expected);
    const visibleImages=tags(page.html,'img').map(img=>new URL(img.src,page.url).href);
    for(const url of links){
      assert(visibleImages.includes(url),'Image must be rendered on '+page.url+': '+url);
      assert(fs.existsSync(path.join(root,new URL(url).pathname)),'Missing image: '+url);
    }
  }
});

test('social metadata points to the real VS JPEG and the legacy card URL serves the same image',()=>{
  assert.match(site.ogImage.path,/^assets\/branding\/sengoku-vs-ogp-(?:\d{8}|v\d+)\.jpg$/);
  assert.equal(site.ogImage.type,'image/jpeg');
  const image=bytes(site.ogImage.path);
  assert.deepEqual(jpegSize(image),{width:site.ogImage.width,height:site.ogImage.height});
  assert(image.equals(bytes('assets/ogp.jpg')),'Old shared links must no longer receive the previous game image');
});

test('public pages and nested 404 use the current favicon family, Apple icon and pinned-tab mark',()=>{
  const surfaces=[...pages,{path:'/tools/music-audition.html',url:site.origin+'/tools/music-audition.html',html:read('tools/music-audition.html')},{path:'/unknown/nested/page',url:site.origin+'/unknown/nested/page',html:read('404.html')}];
  const icons=[site.faviconSmall,site.favicon,site.faviconIco,site.faviconSvg];
  for(const page of surfaces){
    const links=tags(page.html,'link');
    for(const spec of icons){
      assert(spec?.path&&spec.sizes&&spec.type,'Each published favicon needs a defined source');
      const matching=links.filter(link=>link.rel==='icon'&&link.sizes===spec.sizes);
      assert.equal(matching.length,1,spec.sizes+' favicon on '+page.path);
      assert.equal(new URL(matching[0].href,page.url).href,site.origin+'/'+spec.path);
      assert.equal(matching[0].type,spec.type);
    }
    assert.equal(links.filter(link=>/^(?:shortcut )?icon$/i.test(link.rel||'')).length,icons.length,'No old favicon competes with the current brand');
    const apple=links.filter(link=>link.rel==='apple-touch-icon');
    assert.equal(apple.length,1,'One Apple icon on '+page.path);
    assert.equal(new URL(apple[0].href,page.url).href,site.origin+'/'+site.appleTouchIcon.path);
    assert.equal(apple[0].sizes,site.appleTouchIcon.sizes);
    const mask=links.filter(link=>link.rel==='mask-icon');assert.equal(mask.length,1,'One pinned-tab icon on '+page.path);
    assert.equal(new URL(mask[0].href,page.url).href,site.origin+'/'+site.maskIcon.path);assert.equal(mask[0].color,site.maskIcon.color);
  }
  for(const page of pages){
    const brand=page.html.match(/<(?:div|a)\b[^>]*class="[^"]*\b(?:mobile-brand|site-brand)\b[^"]*"[^>]*>\s*(<img\b[^>]*>)/i);
    assert(brand,'Visible brand image on '+page.path);
    assert.equal(new URL(attrs(brand[1]).src,page.url).href,site.origin+'/'+site.favicon.path);
  }
  const manifest=JSON.parse(read('manifest.webmanifest'));
  assert.deepEqual(manifest.icons,site.appIcons);
  const anyIcons=site.appIcons.filter(icon=>icon.purpose==='any'),maskableIcons=site.appIcons.filter(icon=>icon.purpose==='maskable');
  assert.deepEqual(anyIcons.map(icon=>icon.sizes).sort(),['192x192','512x512']);
  assert(maskableIcons.some(icon=>Number(icon.sizes.split('x')[0])>=512),'Provide a dedicated 512px or larger maskable icon');
  assert.equal(new Set(site.appIcons.map(icon=>icon.src)).size,site.appIcons.length,'Normal and maskable artwork must be separate');
  for(const icon of site.appIcons){
    const [width,height]=icon.sizes.split('x').map(Number);
    assert.deepEqual(pngSize(bytes(icon.src)),{width,height});
    assert.equal(width,height,'App icons must be square');
    assert.equal(icon.type,'image/png');
    assert(['any','maskable'].includes(icon.purpose));
    if(icon.purpose==='maskable')assertOpaquePng(bytes(icon.src));
  }
  assert.deepEqual(pngSize(bytes(site.logo.path)),{width:site.logo.width,height:site.logo.height});
  assert.equal(site.faviconSvg.type,'image/svg+xml');assert.equal(site.faviconSvg.sizes,'any');
  assertSelfContainedSvg(site.faviconSvg.path);assertSelfContainedSvg(site.maskIcon.path);
  assert(/^#[0-9a-f]{6}$/i.test(site.maskIcon.color),'Pinned-tab tint must be an explicit color');
});

test('root favicon contains real small-to-large PNG frames and Apple fallback matches the current icon',()=>{
  assert.equal(site.faviconIco.path,'favicon.ico');
  const ico=bytes(site.faviconIco.path);
  assert(ico.length>=6);
  assert.equal(ico.readUInt16LE(0),0);assert.equal(ico.readUInt16LE(2),1);
  const count=ico.readUInt16LE(4),entries=[];
  const declared=site.faviconIco.sizes.split(/\s+/);assert.equal(count,declared.length);assert(ico.length>=6+count*16);
  let endOfPrevious=6+count*16;
  for(let index=0;index<count;index++){
    const header=6+index*16,width=ico[header]||256,height=ico[header+1]||256;
    const size=ico.readUInt32LE(header+8),offset=ico.readUInt32LE(header+12);
    assert(offset>=endOfPrevious&&size>0&&offset+size<=ico.length,'ICO payloads must not overlap or leave the file');endOfPrevious=offset+size;
    const png=ico.subarray(offset,offset+size);
    assert.deepEqual(pngSize(png),{width,height});
    const source=[site.faviconSmall,site.favicon].find(icon=>icon.sizes===width+'x'+height);
    if(source)assert(png.equals(bytes(source.path)),'ICO artwork must match the standalone PNG');
    entries.push(width+'x'+height);
  }
  assert.deepEqual(entries.sort(),declared.sort());assert.equal(new Set(entries).size,count);
  for(const size of [16,32,48,96,192])assert(entries.includes(size+'x'+size),'Missing desktop/favicon frame: '+size);
  const apple=bytes(site.appleTouchIcon.path);
  assert.deepEqual(pngSize(apple),{width:180,height:180});
  assert(apple.equals(bytes('apple-touch-icon.png')),'Root Apple fallback must not serve the previous icon');
});

test('existing icon aliases no longer return the retired brand artwork',()=>{
  for(const [source,aliases] of [
    [site.favicon.path,['assets/icon-192.png','assets/sengoku-taisen-icon-192.png']],
    [site.logo.path,['assets/icon-512.png','assets/sengoku-taisen-icon-512.png']],
    [site.faviconSmall.path,['assets/favicon-32.png','assets/sengoku-taisen-favicon-32.png']],
    [site.appleTouchIcon.path,['assets/apple-touch-icon.png']]
  ])for(const file of aliases)assert(bytes(source).equals(bytes(file)),'The compatibility URL must serve the current brand: '+file);
});

test('search-image and social crawlers can fetch every public page, preview and brand icon',()=>{
  const groups=[];let group=null;
  for(const raw of read('robots.txt').split(/\r?\n/)){
    const match=raw.replace(/#.*/,'').trim().match(/^([\w-]+):\s*(.*)$/);if(!match)continue;
    const field=match[1].toLowerCase(),value=match[2];
    if(field==='user-agent'){
      if(!group||group.rules.length){group={agents:[],rules:[]};groups.push(group);}
      group.agents.push(value.toLowerCase());
    }else if(group&&['allow','disallow'].includes(field)&&value)group.rules.push({allow:field==='allow',value});
  }
  const paths=new Set([...pages.map(page=>page.path),...pages.map(page=>'/'+(page.socialImage||site.ogImage).path),...[site.favicon,site.faviconSmall,site.faviconIco,site.faviconSvg,site.appleTouchIcon].map(icon=>'/'+icon.path),...site.appIcons.map(icon=>'/'+icon.src)]);
  for(const agent of ['googlebot-image','twitterbot','facebookexternalhit']){
    const specificity=group=>Math.max(0,...group.agents.map(token=>token!=='*'&&agent.startsWith(token)?token.length:0));
    const longest=Math.max(0,...groups.map(specificity));
    const selected=longest?groups.filter(group=>specificity(group)===longest):groups.filter(group=>group.agents.includes('*'));
    for(const pathname of paths){
      const matching=selected.flatMap(group=>group.rules).filter(rule=>{
        const pattern=rule.value.split('*').map(part=>part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*').replace(/\\\$$/,'$');
        return new RegExp('^'+pattern).test(pathname);
      }).sort((a,b)=>b.value.replace(/\*/g,'').length-a.value.replace(/\*/g,'').length||Number(b.allow)-Number(a.allow));
      assert(!matching.length||matching[0].allow,agent+' cannot crawl '+pathname);
    }
  }
});

test('the home introduction is visible HTML and still preserves the existing game entry',()=>{
  const html=pages.find(p=>p.key==='home').html,intro=html.match(/<p\b[^>]*class="launch-introduction"[^>]*>([\s\S]*?)<\/p>/)?.[1];
  assert(intro);assert.equal(normalized(intro),normalized(site.launchIntroduction.join('')));assert.equal([...html.matchAll(/\bid="launch-enter"/g)].length,1);assert(html.includes('id="main"'));assert(html.includes('id="launch-screen"'));
});

test('current battle limits and automatic mail are explained in public HTML without loading the game',()=>{
  const guide=pages.find(page=>page.key==='guide').html,article=guide.match(/<article\b([^>]*)>([\s\S]*?)<\/article>/);
  assert(article);assert(!/\bhidden\b|aria-hidden=["']true/.test(article[1]));
  const table=article[2].match(/<table\b[^>]*><caption>共通フィールドの城・成長上限・勝利時の扱い<\/caption>([\s\S]*?)<\/table>/)?.[1];assert(table);
  const rows=[...table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].slice(1).map(match=>normalized(match[1]));
  assert.equal(rows.length,3);assert.match(rows[0],/^江戸城・京都御所江戸城Lv\.64／京都御所Lv\.128報酬戦/);assert(rows[0].includes('各500'));assert(rows[0].includes('占領できず'));
  assert.match(rows[1],/^二条城・大坂城・名古屋城Lv\.48占領戦/);assert(rows[1].includes('自分の所領'));
  assert.match(rows[2],/^通常の本拠Lv\.32限定襲撃/);assert(rows[2].includes('攻撃側への占領移転はなく'));assert(rows[2].includes('家臣が待っている場合'));assert(rows[2].includes('入城順で次の領主へ交代'));
  const mail=article[2].match(/<section\b([^>]*\bid="system-mail"[^>]*)>([\s\S]*?)<\/section>/);assert(mail);assert(!/\bhidden\b|aria-hidden=["']true/.test(mail[1]));
  const text=normalized(mail[2].replace(/<(?:script|style)\b[\s\S]*?<\/(?:script|style)>/gi,''));
  for(const phrase of ['共通フィールドの対人戦','それぞれ1通','「交流」→「郵便」','未読','移転前と移転先','戦闘の確定時に反映済み','返信や贈り物の受取操作はありません','天下地図のCPU戦'])assert(text.includes(phrase),phrase);
  const about=pages.find(page=>page.key==='about'),recovery=pages.find(page=>page.key==='recovery');
  for(const page of [about,recovery])assert(tags(page.html,'a').some(link=>link.href&&new URL(link.href,page.url).href===site.origin+'/guide/#system-mail'),'Related public pages link directly to the mail guide');
  assert(recovery.html.includes('id="relocated-home"'));assert(tags(about.html,'a').some(link=>link.href&&new URL(link.href,about.url).href===site.origin+'/guide/#field-battles'));
});

test('the beginner upgrade guide gives separate keep and castle steps, actual controls and reservation limits',()=>{
  const guide=pages.find(page=>page.key==='guide'),section=guide.html.match(/<section\b([^>]*\bid="castle-upgrades"[^>]*)>([\s\S]*?)<\/section>/);
  assert(section);assert(!/\bhidden\b|aria-hidden=["']true/.test(section[1]));
  const text=normalized(section[2]);
  for(const phrase of ['「天守」','「城郭レベル」','それぞれ別の工事','城下町で「天守」を開く','「天下地図」から「本拠へ」を押す','その後、本拠の城を押して選択','「城郭の拡張」','「Lv.Nへ拡張する」','「次の増築を予約」','予約の取り消しはできません','同じ城郭の工事中は、次の段階を予約できません','指令1回と金銭・木材・石材','120秒または180秒','60秒・120秒・180秒','Lv.8・16・24・32','最大6枠'])assert(text.includes(phrase),phrase);
  for(const limit of ['Lv.32','Lv.48','Lv.64','Lv.128'])assert(text.includes(limit));
  assert(tags(guide.html,'a').some(link=>link.href==='#castle-upgrades'));
  const about=pages.find(page=>page.key==='about');assert(tags(about.html,'a').some(link=>link.href&&new URL(link.href,about.url).href===site.origin+'/guide/#castle-upgrades'));
});

test('public discovery identifies only Sengoku VS and does not explain privileged player identities',()=>{
  for(const page of pages){
    const visible=normalized(page.html.replace(/<(?:script|style)\b[\s\S]*?<\/(?:script|style)>/gi,''));
    assert(!/双月のアルケイア|パチモン|Pachi Monsters|Archeia of the Twin Moons/i.test(visible),page.key+' contains a retired title');
    assert(!/スタッフ|運営専用|運営の本拠|德川家|以前の領主・運営/.test(visible),page.key+' reveals privileged identity mappings');
    assert(!tags(page.html,'a').some(link=>/#operator(?:$|[?&])/.test(link.href||'')),page.key+' advertises private role recovery');
  }
  const guide=pages.find(page=>page.key==='guide');
  for(const phrase of ['購入した商品の印','外観を通常に戻しても','有効な利用期間中'])assert(guide.html.includes(phrase),phrase);
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
  assert(result.ok);assert.equal(result.mode,'dry-run');assert.equal(result.networkRequests,0);assert.equal(result.notificationAttempted,false);assert.equal(result.urlCount,pages.length);assert.equal(result.accepted,false);assert.equal(result.indexingVerified,false);assert.equal(calls,0);assert(!Object.hasOwn(result,'key'));assert(!Object.hasOwn(result,'payload'));assert.equal(read('tools/indexnow-config.json'),before);assert.equal(read(plan.keyFile),keyBefore);
 });
 test('CLI rejects arbitrary endpoints/URLs and incompatible local key configuration before any request',async()=>{
  for(const argv of [['--url','https://other.invalid/'],['https://other.invalid/'],['--submit','--host=other.invalid'],['--submit','--submit']]){const result=await notifier.run({argv,root,fetchImpl:()=>assert.fail('must not fetch')});assert.equal(result.ok,false);assert.equal(result.code,'INVALID_ARGUMENT');}
  for(const change of [dir=>{const file=path.join(dir,'tools/indexnow-config.json'),c=JSON.parse(fs.readFileSync(file));c.host='other.invalid';fs.writeFileSync(file,JSON.stringify(c));},dir=>fs.writeFileSync(path.join(dir,plan.keyFile),'not-the-key')]){
   const dir=fixture(change);try{const result=await notifier.run({argv:['--submit'],root:dir,fetchImpl:()=>assert.fail('must not fetch')});assert.equal(result.ok,false);assert.equal(result.notificationAttempted,false);}finally{fs.rmSync(dir,{recursive:true,force:true});}
  }
 });
 test('only the known same-host canonical sitemap URLs and valid dates can become a notification',()=>{
  const xml=read('sitemap.xml');assert.deepEqual(notifier.parseSitemap(xml),notifier.URLS);
  for(const bad of [xml.replace(site.origin,'https://other.invalid'),xml.replace(site.origin+'/guide/',site.origin+'/guide/?tracking=1'),xml.replace(site.origin+'/about/',site.origin+'/guide/'),xml.replace('<urlset','<!DOCTYPE urlset><urlset'),xml.replace(/<lastmod>[^<]+<\/lastmod>/,'<lastmod>2026-02-30</lastmod>'),xml.replace('<urlset','<sitemapindex')])assert.throws(()=>notifier.parseSitemap(bad));
 });
 test('submit waits for every published check, then sends exactly one bounded canonical-URL POST',async()=>{
  let releasePage,seenPage;const seen=new Promise(resolve=>{seenPage=resolve;});
  const transport=mock((url,options)=>{if(options.method==='GET'&&url===site.origin+'/premium/'){seenPage();return new Promise(resolve=>{releasePage=()=>resolve(response(pages.find(page=>page.key==='premium').html));});}});
  const pending=notifier.run({argv:['--submit'],root,fetchImpl:transport.fetchImpl});await seen;assert.equal(transport.posts().length,0);releasePage();const result=await pending;
  assert(result.ok);assert.equal(result.result,'received');assert.equal(result.accepted,true);assert.equal(result.keyValidationPending,false);assert.equal(result.indexingVerified,false);assert.equal(result.pagesVerified,pages.length);assert.equal(transport.posts().length,1);assert.equal(transport.calls.length,pages.length+3);
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
  const page=pages.find(page=>page.key==='premium');
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
