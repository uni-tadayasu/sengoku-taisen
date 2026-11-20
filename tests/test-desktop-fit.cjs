'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {computeFit,planViewport}=require('../desktop-fit.js');
const isolated={module:{exports:{}}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../desktop-fit.js'),'utf8').replace('const api={refresh','const api={fitDialog,refresh'),isolated);
const {fitDialog}=isolated.module.exports;
function socialDialog(height=760){
  const body={scrollTop:70},style={},dialog={open:true,hidden:false,style,dataset:{},confirmation:null,classList:{contains:name=>name==='social-dialog'},querySelector:selector=>selector==='.social-body'?body:selector==='.social-confirm-card'?dialog.confirmation:null,getBoundingClientRect(){throw Error('Transformed measurements would create a scale feedback loop');}};
  Object.defineProperties(dialog,{offsetWidth:{get:()=>940},scrollWidth:{get:()=>940},offsetHeight:{get:()=>Math.max(height,parseFloat(style.minHeight)||0)},scrollHeight:{get:()=>dialog.offsetHeight}});
  return{dialog,body};
}
let count=0;const test=(name,fn)=>{fn();count++;console.log('PASS '+name);};
test('desktop virtual layout survives browser zoom through 200 percent',()=>{
  for(const [physicalWidth,physicalHeight]of [[1920,1080],[1440,900],[1366,768],[1280,720]])for(const zoom of [1,1.25,1.5,1.75,2]){
    const plan=planViewport(physicalWidth/zoom,physicalHeight/zoom,34);
    assert.ok(plan.layoutWidth>=1100);assert.ok(plan.layoutHeight>=720);
    const fit=computeFit(plan.layoutWidth,Math.max(plan.layoutHeight,950),plan.availableWidth,plan.availableHeight);
    assert.ok(fit.width<=plan.availableWidth+1e-8);assert.ok(fit.height<=plan.availableHeight+1e-8);
    assert.ok(fit.scale>0&&fit.scale<=1);assert.ok(fit.left>=0&&fit.top>=0);
  }
});
test('map and town budgets follow available height without oversized fixed minima',()=>{
  const short=planViewport(680,360,34),tall=planViewport(1920,1200,34);
  assert.ok(short.mapHeight>=260&&short.mapHeight<400);assert.ok(tall.mapHeight>short.mapHeight);
  assert.ok(short.townHeight>=255&&tall.townHeight>short.townHeight);
});
test('full modal contents stay inside the viewport without cropping',()=>{
  for(const size of [[780,500],[780,1100],[780,1750]])for(const viewport of [[1920,1080],[960,540],[640,360]]){
    const fit=computeFit(...size,viewport[0]-24,viewport[1]-24);
    assert.ok(12+fit.left+fit.width<=viewport[0]-12+1e-8);assert.ok(12+fit.top+fit.height<=viewport[1]-12+1e-8);
  }
});
test('already fitted rectangles are never needed for the fit calculation',()=>{
  const initial=computeFit(1400,1000,1000,650),again=computeFit(1400,1000,1000,650);
  assert.deepEqual(initial,again);assert.equal(initial.scale,.65);
});
test('large displays keep natural pixel scale and do not enlarge the interface',()=>{
  const fit=computeFit(1100,720,2200,1440);assert.equal(fit.scale,1);assert.equal(fit.left,550);assert.equal(fit.top,360);
});
test('the actual social dialog is fitted at stable desktop width through 200 percent zoom',()=>{
  for(const [physicalWidth,physicalHeight]of [[1920,1080],[1440,900],[1366,768],[1280,720]])for(const zoom of [1,1.25,1.5,1.75,2]){
    const {dialog,body}=socialDialog(),viewport={viewportWidth:physicalWidth/zoom,viewportHeight:physicalHeight/zoom};fitDialog(dialog,viewport);
    const scale=Number(dialog.style.transform.match(/^scale\((.+)\)$/)[1]),left=parseFloat(dialog.style.left),top=parseFloat(dialog.style.top);
    assert(scale>0&&scale<=1);assert(left>=12-.001&&top>=12-.001);assert(left+940*scale<=viewport.viewportWidth-12+.001);assert(top+760*scale<=viewport.viewportHeight-12+.001);
    assert.equal(body.scrollTop,0,'The form body has no retained scroll position');assert.equal(dialog.offsetWidth,940,'Browser zoom does not switch the virtual dialog to mobile width');
  }
});
test('confirmation height contributes to social fit and is cleared after confirmation closes',()=>{
  const {dialog}=socialDialog(380),viewport={viewportWidth:657,viewportHeight:444};dialog.confirmation={offsetWidth:580,scrollWidth:580,offsetHeight:630,scrollHeight:630};
  fitDialog(dialog,viewport,7,9);assert.equal(dialog.style.minHeight,'678px');
  const scale=Number(dialog.style.transform.match(/^scale\((.+)\)$/)[1]);assert(parseFloat(dialog.style.top)+dialog.offsetHeight*scale<=9+444-12+.001);assert(parseFloat(dialog.style.left)>=7+12);
  const first=JSON.stringify(dialog.style);fitDialog(dialog,viewport,7,9);assert.equal(JSON.stringify(dialog.style),first,'Repeated fit uses unscaled dimensions without compounding');
  dialog.confirmation=null;fitDialog(dialog,viewport);assert.equal(dialog.style.minHeight,'');assert.equal(dialog.offsetHeight,380);
});
test('desktop social CSS keeps finite forms visible and bounds long record histories',()=>{
  const css=fs.readFileSync(path.join(__dirname,'../desktop-fit.css'),'utf8');
  const block=selector=>{const escaped=selector.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),match=css.match(new RegExp(escaped+'\\{([^}]+)\\}'));assert(match,'Missing scoped rule '+selector);return match[1];};
  const dialog=block('.sengoku-desktop-fit .social-dialog');assert(dialog.includes('width:940px'));assert(dialog.includes('height:auto'));assert(dialog.includes('max-height:none'));assert(dialog.includes('transform-origin:0 0'));
  assert(block('.sengoku-desktop-fit .social-body').includes('overflow:visible'));assert(block('.sengoku-desktop-fit .social-staff-layout').includes('grid-template-columns:repeat(2,minmax(0,1fr))'));
  for(const selector of ['.sengoku-desktop-fit .social-message-list','.sengoku-desktop-fit .social-body>.social-card-list','.sengoku-desktop-fit .social-letter-body']){const declarations=block(selector);assert(declarations.includes('max-height:'));assert(declarations.includes('overflow-y:auto'),'Long records must retain bounded scrolling instead of shrinking the whole dialog');}
  assert(block('.sengoku-desktop-fit .social-body:has(>#social-device-name-form)').includes('grid-template-columns:repeat(2,minmax(0,1fr))'));
});
console.log(count+' desktop viewport-fit checks passed.');
