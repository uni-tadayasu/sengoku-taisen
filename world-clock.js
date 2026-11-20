/* © KASAI SOLUTIONS — a shared monotonic clock with a looping calendar. */
(function(global){
 'use strict';
 const CALENDAR=Object.freeze({startYear:1560,yearsPerCycle:56,monthsPerCycle:672,secondsPerMonth:60});
 function calendar(elapsedMs){const turn=Math.floor(Math.max(0,elapsedMs)/60000),within=turn%CALENDAR.monthsPerCycle;return{...CALENDAR,turn,cycle:Math.floor(turn/CALENDAR.monthsPerCycle)+1,year:CALENDAR.startYear+Math.floor(within/12),month:within%12+1,elapsed:(Math.max(0,elapsedMs)%60000)/1000};}
 function create(options={}){
  const now=options.now||(()=>global.performance.now()),fetcher=options.fetch||global.fetch?.bind(global),later=options.setTimeout||global.setTimeout?.bind(global),cancel=options.clearTimeout||global.clearTimeout?.bind(global),isOnline=options.online||(()=>global.navigator?.onLine!==false),hidden=options.hidden||(()=>Boolean(global.document?.hidden));
  const base=options.base??global.SENGOKU_API_BASE??'',offline=options.offline??(global.location?.protocol==='file:');
  const listeners=new Set();let sample=null,received=0,requestStart=0,pending=null,timer=null,stopped=true,lastError='',generation=0;
  function valid(c){return c&&typeof c.id==='string'&&c.id.length>0&&c.id.length<=100&&Number.isSafeInteger(c.elapsedMs)&&c.elapsedMs>=0&&c.elapsedMs<60000000000000&&typeof c.running==='boolean'&&[1,2,4].includes(c.speed)&&Number.isSafeInteger(c.revision)&&c.revision>=0&&Number.isFinite(Date.parse(c.serverTime));}
  function snapshot(){
   if(!sample)return{ready:false,mode:offline?'offline':'shared',message:lastError||'共通時刻を確認しています。',clock:null};
   const age=Math.max(0,now()-received),ready=offline||(isOnline()&&age<=15000),elapsedMs=Math.floor(sample.elapsedMs+(sample.running?age*sample.speed:0));
   const clock={...sample,elapsedMs,confirmedElapsedMs:offline?elapsedMs:sample.elapsedMs,calendar:calendar(elapsedMs)};
   return{ready,mode:offline?'offline':'shared',message:offline?'オフライン版の時間です。':ready?(sample.running?'全プレイヤー共通の時間で進行中':'運営が共通時間を停止中'):lastError||'共通時刻へ再接続しています。',clock,ageMs:age};
  }
  function emit(){const state=snapshot();for(const listener of listeners){try{listener(state);}catch(_){}}}
  function accept(clock,{roundTripMs=0}={}){
   if(!valid(clock))throw Error('共通時刻の応答が正しくありません。');
   if(sample&&clock.id===sample.id&&clock.revision<sample.revision)return false;
   const elapsedMs=clock.elapsedMs; // Server timestamp is the sole authority; never use the device's wall clock.
   if(sample&&clock.id===sample.id&&clock.revision===sample.revision&&elapsedMs<sample.elapsedMs)return false;
   sample={id:clock.id,elapsedMs,running:clock.running,speed:clock.speed,revision:clock.revision,serverTime:clock.serverTime};received=now();lastError='';emit();return true;
  }
  function schedule(){if(timer!==null)cancel?.(timer);timer=null;if(!stopped&&!offline&&!hidden())timer=later(()=>{timer=null;refresh();},5000);}
  async function refresh(){
   if(offline){emit();return snapshot();}if(pending)return pending;if(stopped)return snapshot();const gen=generation;
   if(!isOnline()){lastError='通信が戻ると共通時刻へ追いつきます。';emit();schedule();return snapshot();}
   const task=Promise.resolve().then(async()=>{let abort,timeout;try{
    abort=typeof AbortController==='function'?new AbortController():null;if(abort)timeout=later(()=>abort.abort(),8000);requestStart=now();
    const response=await fetcher(base.replace(/\/$/,'')+'/api/v1/world-clock',{method:'GET',cache:'no-store',credentials:'omit',signal:abort?.signal});
    if(!response.ok)throw Error('共通時刻を受信できませんでした。');const body=await response.json();if(gen!==generation||stopped)return snapshot();
    if(body.ok!==true)throw Error(body.error?.message||'共通時刻を受信できませんでした。');accept(body.clock,{roundTripMs:now()-requestStart});
   }catch(error){if(gen===generation&&!stopped){lastError='共通時刻へ再接続しています。';emit();}}finally{if(timeout)cancel?.(timeout);if(gen===generation){pending=null;schedule();}}
   return snapshot();});pending=task;return task;
  }
  function start(){if(!stopped)return refresh();stopped=false;generation++;if(offline){const s=options.initialState?.()||global.SengokuBridge?.getState?.();sample={id:'offline-world-v1',elapsedMs:Math.max(0,Math.floor(s?.worldClock?.elapsedMs??((s?.turn||0)*60000+(s?.realtime?.elapsed||0)*1000))),running:true,speed:1,revision:0,serverTime:new Date().toISOString()};received=now();emit();return Promise.resolve(snapshot());}return refresh();}
  function stop(){stopped=true;generation++;pending=null;if(timer!==null)cancel?.(timer);timer=null;}
  function visibility(){if(stopped)return;if(hidden()){if(timer!==null)cancel?.(timer);timer=null;}else refresh();}
  return{start,stop,refresh,snapshot,accept,calendar,subscribe(fn){listeners.add(fn);fn(snapshot());return()=>listeners.delete(fn);},visibility};
 }
 const api=create();api.create=create;api.CALENDAR=CALENDAR;global.SengokuWorldClock=api;
 if(typeof module!=='undefined'&&module.exports)module.exports={create,calendar,CALENDAR};
 if(global.document){global.document.addEventListener('visibilitychange',api.visibility);global.addEventListener?.('online',()=>api.refresh());global.addEventListener?.('offline',()=>api.refresh());}
})(typeof window!=='undefined'?window:globalThis);
