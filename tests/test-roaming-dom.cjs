/* Browser behavior checks; run with Playwright and its Chromium installed. */
'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),{existsSync}=require('node:fs'),{chromium}=require('playwright');
const root=path.join(__dirname,'..');
(async()=>{
 const executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined);
 const browser=await chromium.launch({headless:true,executablePath});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<!doctype html><meta charset="utf-8"><button id="outside">Outside</button><main id="host"></main>');
  for(const file of ['officers-data.js','travel.js','engine.js','travel-ui.js','roaming.js'])await page.addScriptTag({path:path.join(root,file)});
  await page.evaluate(function mountRoamingTest(){
   window.game=new SengokuEngine({officers:SENGOKU_OFFICERS,seed:4});const stored=new Map();let id=0;
   window.SengokuArt={facility:()=>'<span class="roaming-illustration" aria-hidden="true"></span>',decorate(){document.querySelectorAll('button').forEach(b=>{b.dataset.buttonArtEnhanced='1';b.classList.add('art-enhanced');if(!b.querySelector('svg'))b.insertAdjacentHTML('afterbegin','<svg aria-hidden="true" width="1" height="1"></svg>');});}};
   window.ui=SengokuRoaming.mount(document.querySelector('#host'),{getGame:()=>game,getStatus:()=>({ownerId:'local',linked:false,writable:true}),storage:{getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)},uuid:()=>`dom-request-${++id}`,battle:async body=>{
     const config=SengokuEngine.roamingDeploymentDefaults();
     const deploymentUnit=SengokuEngine.roamingDeploymentUnits(config,body.castleId).find(unit=>unit.unitId===body.unitId);
     const departure=game.departRoamingBattle(body.encounterId,body.tactic,body.troops,{...body,deploymentUnit,respawnSeconds:config.respawnSeconds});
     if(!departure.ok)return departure;
     // A delayed command can return an arrival receipt after the troops have already landed.
     if(window.holdBattle)await new Promise(resolve=>window.finishBattle=resolve);
     let remaining=departure.march.remainingMs/1000;
     while(remaining>0){const seconds=Math.min(5,remaining);game.tick(seconds);remaining-=seconds;}
     return game.departRoamingBattle(body.encounterId,body.tactic,body.troops,body);
   }});
  });
  const action=name=>page.locator(`[data-roaming-action="${name}"]`);
  const troops=page.locator('[data-roaming-id]');
  assert.equal(await troops.count(),3,'mapped deployments from the selected castle');
  const enemy=troops.first();
  await enemy.focus();await page.keyboard.press('Enter');assert.equal(await enemy.getAttribute('aria-pressed'),'true');assert(await enemy.evaluate(el=>el===document.activeElement));
  await page.evaluate(()=>{window.savedEnemy=document.activeElement;game.state.resources.rice++;ui.refresh();});assert(await enemy.evaluate(el=>el===savedEnemy&&el===document.activeElement),'Encounter selection and live updates retain keyboard focus and the button node');
  const input=page.locator('#roaming-troops');await input.fill('1200');await page.evaluate(()=>{window.savedInput=document.activeElement;game.state.resources.rice++;ui.refresh();});assert(await input.evaluate(el=>el===savedInput&&el===document.activeElement));assert.equal(await input.inputValue(),'1200');
  const select=page.locator('#roaming-tactic');await select.focus();await page.evaluate(()=>{window.savedSelect=document.activeElement;game.state.resources.rice++;ui.refresh();});assert(await select.evaluate(el=>el===savedSelect&&el===document.activeElement),'Focused native select stays attached across live ticks');
  await page.keyboard.press('ArrowDown');assert.equal(await select.inputValue(),'assault');assert.equal(await page.evaluate(()=>ui.controller.snapshot().tactic),'assault');assert(await select.evaluate(el=>el===savedSelect&&el===document.activeElement),'Changing a native option retains the same select');
  await action('half').focus();await page.keyboard.press('Enter');assert(await action('half').evaluate(el=>el===document.activeElement));
  await action('all').focus();await page.keyboard.press('Enter');assert(await action('all').evaluate(el=>el===document.activeElement));
  await page.locator('.roaming-help summary').click();assert(await page.locator('.roaming-help').evaluate(el=>el.open));
  await action('prepare').focus();await page.keyboard.press('Enter');assert(await page.locator('.roaming-confirm').evaluate(el=>el===document.activeElement));
  await page.evaluate(()=>{game.state.resources.rice++;ui.refresh();});assert(await page.locator('.roaming-confirm').evaluate(el=>el===document.activeElement));assert(await page.locator('.roaming-help').evaluate(el=>el.open));
  await page.keyboard.press('Tab');assert(await action('cancel').evaluate(el=>el===document.activeElement));await page.keyboard.press('Enter');assert(await action('prepare').evaluate(el=>el===document.activeElement));
  await page.keyboard.press('Enter');await action('submit').focus();await page.evaluate(()=>window.holdBattle=true);await page.keyboard.press('Enter');assert(await page.locator('.roaming-pending').evaluate(el=>el===document.activeElement));
  assert.equal(await page.evaluate(()=>game.state.roaming.sequence),0,'launch does not grant instant rewards');
  assert.equal(await page.evaluate(()=>game.state.march.options.unitId),await enemy.getAttribute('data-roaming-id'));
  await page.evaluate(()=>finishBattle());await page.waitForSelector('.roaming-report');assert(await page.locator('.roaming-report').evaluate(el=>el===document.activeElement));assert.equal(await page.evaluate(()=>game.state.roaming.sequence),1);
  await troops.nth(1).click();
  assert.equal(Number(await input.inputValue()),Number(await input.getAttribute('max')));
  assert(await input.evaluate(el=>el.validity.valid));
  await action('prepare').focus();await page.keyboard.press('Enter');await action('submit').focus();await page.keyboard.press('Enter');await page.locator('#outside').focus();await page.evaluate(()=>finishBattle());await page.waitForFunction(()=>game.state.roaming.sequence===2);assert(await page.locator('#outside').evaluate(el=>el===document.activeElement),'Delayed battle result does not steal focus from outside the CPU view');
  await page.evaluate(()=>ui.dispose());assert.deepEqual(errors,[]);console.log('PASS real Chromium keyboard focus, native-control identity, art decoration, confirmation/result focus and delayed-response focus checks');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
