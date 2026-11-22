/* Test the game's relocation dialog command, durable request record and social
   transport together, across reloads and two tabs. The Worker is simulated. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {test} = require('node:test');
const Residency = require('../residency.js');

function sourceSlice(file, start, end) {
  const source = fs.readFileSync(require.resolve('../' + file), 'utf8');
  const first = source.indexOf(start), last = source.indexOf(end, first + start.length);
  assert(first >= 0 && last > first, 'Expected real entry point in ' + file);
  return source.slice(first, last);
}
const command = sourceSlice('app.js', '  function relocationCommand(', '  function relocationRole(');
const transport = sourceSlice('social.js', 'async function residencyRequest(', 'async function branchRequest(');
const move = '/castles/residency/relocate';
const lookup = move + '?receipt=1';

function storage() {
  const values = new Map();
  return {getItem: key => values.get(key) ?? null, setItem: (key,value) => values.set(key,value), removeItem: key => values.delete(key)};
}

function tab({journal, device, network, revision = 4, writable = true, player = 'u_first'}) {
  const context = {epoch:1, accountEpoch:1, privilegeEpoch:1, playerId:player, user:{id:player}, connected:true};
  const status = {linked:true, ready:true, writable, revision};
  const applied = [];
  const sync = {
    getDevice: () => ({id:device}), getStatus: () => status,
    async acceptSnapshot(value) { applied.push(value); return {ok:true}; }
  };
  const scope = {URLSearchParams, localStorage:journal, crypto:{randomUUID:()=>device+'-request-original'},
    s:{identity:{id:player}}, getCourtContext:()=>({...context}),
    staleIdentity:()=>Object.assign(Error('領主が変わりました'),{code:'STALE_IDENTITY'}),
    sameRelocationPlayer:view=>view.owner===context.playerId && view.epoch===context.epoch,
    api:(route,options)=>network(route, options.data),
    SengokuCloudSync:sync, SengokuResidency:Residency
  };
  scope.window=scope; scope.global=scope;
  vm.createContext(scope);
  vm.runInContext(transport,scope);
  scope.SengokuSocial = {residencyRequest:scope.residencyRequest};
  vm.runInContext(command,scope);
  return {cmd:scope.relocationCommand({owner:player,epoch:context.epoch}), context, status, applied};
}
function receipt(payload, revision = 5) {
  return {ok:true, revision, user:{id:'u_first'}, residency:{castleId:payload.castleId,role:'retainer'},
    admission:{requestId:payload.requestId,castleId:payload.castleId,mode:'retainer'},save:{state:{home:payload.castleId}}};
}
const failure = (status,code) => Object.assign(Error(code), {status,code});
const later = () => { let resolve; const promise = new Promise(done=>resolve=done); return {resolve,promise}; };

test('a lost response can be looked up on a newly opened read-only tab without performing a second move', async()=>{
  const journal=storage(), calls=[];
  let confirmed;
  const network=async (route,body)=>{
    calls.push({route,body});
    if(route===lookup) return confirmed;
    assert.equal(route,move); assert(!confirmed);
    confirmed=receipt(body);
    throw Error('connection ended after the move committed');
  };
  const first=tab({journal,device:'writer-A',network});
  await assert.rejects(first.cmd.run('himeji'),/connection ended/);
  const original=first.cmd.pending();
  const reader=tab({journal,device:'reader-B',network,revision:8,writable:false});
  await assert.rejects(reader.cmd.run('inuyama',original.requestId));
  assert.equal(calls.length,1);
  const response=await reader.cmd.run(original.castleId,original.requestId);
  assert.equal(response.result.residency.role,'retainer');
  assert.deepEqual(calls.map(c=>c.route),[move,lookup]);
  assert.equal(calls[1].body.requestId,original.requestId);
  assert.equal(calls[1].body.revision,original.revision);
  assert.equal(calls[1].body.deviceId,'reader-B');
  assert.equal(reader.cmd.pending(),null);
  assert.equal(reader.applied.length,1);
});

test('a missing receipt stays pending and explicit retry uses its original destination, id and revision', async()=>{
  const journal=storage(),calls=[];
  const network=async (route,body)=>{
    calls.push({route,body});
    if(calls.length===1)throw Error('first delivery uncertain');
    if(route===lookup)throw failure(404,'RELOCATION_RECEIPT_PENDING');
    assert.equal(route,move);
    return receipt(body,9);
  };
  const first=tab({journal,device:'writer-A',network});
  await assert.rejects(first.cmd.run('himeji'),/uncertain/);
  const id=first.cmd.pending().requestId;
  const second=tab({journal,device:'reader-B',network,revision:8,writable:false});
  await assert.rejects(second.cmd.run('himeji',id),error=>error.code==='RELOCATION_RECEIPT_PENDING');
  assert.equal(second.cmd.pending().requestId,id);
  await assert.rejects(second.cmd.run('himeji',id,{resend:true}), error=>error.code==='LOCAL_WRITER_CHANGED');
  assert.equal(calls.length,2);
  assert.equal(second.cmd.pending().requestId,id);
  second.status.writable=true;
  await second.cmd.run('himeji',id,{resend:true});
  assert.deepEqual(calls.map(c=>c.route),[move,lookup,move]);
  assert.equal(calls[2].body.requestId,id); assert.equal(calls[2].body.revision,4);
  assert.equal(calls[2].body.castleId,'himeji'); assert.equal(calls[2].body.deviceId,'reader-B');
  assert.equal(second.cmd.pending(),null);
});

test('changing accounts during the request cannot apply its receipt to the next account', async()=>{
  const journal=storage(),pending=later(),sent=later();
  const first=tab({journal,device:'writer-A',network:async (route,body)=>{
    assert.equal(route,move);sent.resolve(body);return pending.promise;
  }});
  const result=first.cmd.run('himeji');
  const original=await sent.promise;
  const other=tab({journal,device:'writer-A',player:'u_second',network:()=>assert.fail('unexpected send')});
  assert.equal(other.cmd.pending(),null);
  Object.assign(first.context,{epoch:2,playerId:'u_second',user:{id:'u_second'}});
  pending.resolve(receipt(original));
  await assert.rejects(result,error=>error.code==='STALE_IDENTITY');
  assert.equal(first.applied.length,0);
  assert.equal(first.cmd.pending().requestId,original.requestId);
});

test('Escape stays dismissed after a delayed error and repeated confirms send a single command', async()=>{
  const started=later(),response=later(),listeners=new Map(),notifications=[];
  let calls=0,redraws=0;
  const dialog={open:true,addEventListener:(type,fn)=>listeners.set(type,fn)};
  const record={castleId:'himeji',requestId:'uncertain-request-id'};
  const view={target:record.castleId,linked:true,pending:record,resend:false,rows:[],
    command:{pending:()=>record,async run(){calls++;started.resolve();await response.promise;throw Error('応答が途切れました');}}};
  const scope={activeModal:'relocate-confirm',relocationView:view,relocationBusy:false,fieldActionPending:false,
    state:()=>({home:'kiyosu',walking:{campaignId:'campaign-before-move'}}),
    window:{SengokuCloudSync:{}},$:(selector)=>selector==='#modal'?dialog:null,
    sameRelocationPlayer:()=>true,relocationBlock:()=>'',refreshLiveControls(){},queueWorldProgress(){},
    clearGachaPresentation(){},closeModal(){dialog.open=false;scope.activeModal='';},
    drawRelocationConfirm(){redraws++;dialog.open=true;},toast:message=>notifications.push(message)};
  vm.createContext(scope);
  vm.runInContext(sourceSlice('app.js','  async function commitRelocation(', '  async function startRegisteredGame('),scope);
  vm.runInContext(sourceSlice('app.js',"  $('#modal').addEventListener('cancel'","  $('#modal').addEventListener('click'"),scope);
  const attempt=scope.commitRelocation();
  await started.promise;
  await scope.commitRelocation();
  assert.equal(calls,1); assert.equal(scope.fieldActionPending,true);
  let prevented=false;
  listeners.get('cancel')({preventDefault(){prevented=true;}});
  if(!prevented)dialog.open=false;
  assert(!dialog.open);
  response.resolve();
  await attempt;
  assert.equal(redraws,0,'a closed dialog must not reopen due to a late error');
  assert.equal(dialog.open,false); assert.equal(scope.relocationBusy,false);
  assert.equal(scope.fieldActionPending,false); assert.match(notifications.at(-1),/応答が途切れ/);
});
