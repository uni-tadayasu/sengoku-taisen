/* A preserved artwork node must only receive the image from its latest load. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../artwork.js'),'utf8');
const start=source.indexOf('function load(url)'),end=source.indexOf('\nconst backgrounds=',start);
function setup(){
 const requests=[],scope={global:{},cache:new Map(),paintRequests:new WeakMap(),Image:class{set src(url){this.url=url;requests.push(this);}}};
 vm.createContext(scope);vm.runInContext(source.slice(start,end),scope);
 const classes=new Set(),attributes=new Map(),surface={style:{}};
 const el={dataset:{artUrl:'first.webp'},isConnected:true,style:{setProperty(){}},classList:{add:name=>classes.add(name),remove:name=>classes.delete(name)},closest:()=>null,querySelector:()=>surface,setAttribute:(name,value)=>attributes.set(name,value)};
 return{scope,el,surface,requests,classes,attributes};
}
async function run(){
 {const h=setup(),first=h.scope.reveal(h.el);h.el.dataset.artUrl='second.webp';delete h.el.dataset.artLoading;const second=h.scope.reveal(h.el);h.requests[0].onload();await first;assert.equal(h.surface.style.backgroundImage,undefined);assert.equal(h.el.dataset.artLoading,'1','Old finally must not clear current request');h.requests[1].onload();await second;assert.equal(h.surface.style.backgroundImage,'url("second.webp")');assert.equal(h.el.dataset.artReady,'1');assert.equal(h.el.dataset.artLoading,undefined);console.log('PASS only latest URL paints and owns loading state');}
 {const h=setup(),first=h.scope.reveal(h.el);h.el.dataset.artUrl='second.webp';delete h.el.dataset.artLoading;const second=h.scope.reveal(h.el);h.requests[1].onload();await second;h.requests[0].onload();await first;assert.equal(h.surface.style.backgroundImage,'url("second.webp")');assert.equal(h.el.dataset.artReady,'1');console.log('PASS late old response never overwrites newer image');}
 {const h=setup(),first=h.scope.reveal(h.el);h.el.dataset.artUrl='second.webp';delete h.el.dataset.artLoading;const second=h.scope.reveal(h.el);h.requests[0].onerror();await first;assert(!h.classes.has('art-error'));assert.equal(h.el.dataset.artLoading,'1');h.requests[1].onload();await second;assert(!h.classes.has('art-error'));console.log('PASS obsolete failure cannot mark current artwork broken');}
 {const h=setup(),first=h.scope.reveal(h.el);h.el.isConnected=false;h.requests[0].onload();await first;assert.equal(h.surface.style.backgroundImage,undefined);assert.equal(h.el.dataset.artReady,undefined);console.log('PASS removed element is not painted');}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
