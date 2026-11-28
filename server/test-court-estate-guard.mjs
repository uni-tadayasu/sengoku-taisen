import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {withCourtEstateGuard} from './court-estate-guard.js';

let checks=0,queries=0;
const safe={sql:'1=1',args:[]},context=guard=>({guard});
const raw=(guard,estate)=>({...guard,sql:`(${guard.sql}) AND (${estate.sql})`,args:[...guard.args,...estate.args]});
function query(db,sql,args=[]){queries++;return db.prepare(sql).all(...args);}
const value=(db,guard)=>query(db,'SELECT ('+guard.sql+') AS allowed',guard.args)[0].allowed;
function scope(name,run){const db=new DatabaseSync(':memory:');try{run(db);checks++;console.log('PASS '+name);}finally{db.close();}}

scope('packed guards retain null, numeric, text and false comparisons and immutable metadata',db=>{
 const pairs=[[null,null],[null,0],[0,null],[0,0],[1,1],[1,'1'],['001','1'],['',''],[-3,-3],[1.25,1.25],[Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER],["x'); DROP TABLE users; -- ?","x'); DROP TABLE users; -- ?"]];
 for(const op of ['=','IS','<>'])for(const args of pairs){
  const guard=Object.freeze({sql:'? '+op+' ?',args:Object.freeze([...args]),code:'ACCOUNT_CHANGED',message:'Retry the live account',term:Object.freeze({id:'original-term'})});
  const packed=withCourtEstateGuard(guard,context(safe));
  assert.equal(packed.args.length,1);assert.equal(value(db,packed),value(db,raw(guard,safe)),JSON.stringify({op,args}));
  assert.equal(packed.code,guard.code);assert.equal(packed.message,guard.message);assert.equal(packed.term,guard.term);assert.deepEqual(guard.args,args);
 }
 assert.equal(value(db,withCourtEstateGuard({sql:'NULL',args:[]},context(safe))),null);
 assert.equal(value(db,withCourtEstateGuard({sql:'0',args:[]},context(safe))),0);
});

scope('every original account and estate fence still rejects stale atomic debits',db=>{
 db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY,revision INTEGER,writer TEXT,active INTEGER,gold INTEGER); CREATE TABLE appointments(id TEXT PRIMARY KEY,revision INTEGER,token TEXT); CREATE TABLE palace(id INTEGER PRIMARY KEY,revision INTEGER); INSERT INTO accounts VALUES('actor',3,'writer-a',1,10); INSERT INTO appointments VALUES('actor',4,'appointment-a'); INSERT INTO palace VALUES(1,5)");
 const guard={sql:'EXISTS(SELECT 1 FROM accounts a WHERE a.id=? AND a.revision=? AND a.writer=? AND a.active=1)',args:['actor',3,'writer-a']};
 const estate={sql:'EXISTS(SELECT 1 FROM appointments e WHERE e.id=? AND e.revision=? AND e.token=?) AND EXISTS(SELECT 1 FROM palace b WHERE b.id=1 AND b.revision=?)',args:['actor',4,'appointment-a',5]};
 const packed=withCourtEstateGuard(guard,context(estate));assert.equal(packed.args.length,1);assert.equal(value(db,packed),1);
 for(const mutation of ["UPDATE accounts SET revision=4","UPDATE accounts SET writer='writer-b'","UPDATE accounts SET active=0","UPDATE appointments SET revision=5","UPDATE appointments SET token='appointment-b'","DELETE FROM appointments","UPDATE palace SET revision=6"]){
  db.exec('SAVEPOINT race');db.exec(mutation);
  assert.equal(value(db,packed),0,mutation);assert.equal(value(db,raw(guard,estate)),0,mutation);
  assert.deepEqual(query(db,"UPDATE accounts SET gold=gold-3 WHERE id='actor' AND "+packed.sql+' RETURNING gold',packed.args),[],mutation);
  assert.equal(query(db,"SELECT gold FROM accounts WHERE id='actor'")[0].gold,10);db.exec('ROLLBACK TO race; RELEASE race');
 }
 assert.equal(query(db,"UPDATE accounts SET gold=gold-3 WHERE id='actor' AND "+packed.sql+' RETURNING gold',packed.args)[0].gold,7);
});

scope('outer correlations, sibling packed guards and repeated wrapping keep distinct scopes',db=>{
 db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY,revision INTEGER,writer TEXT); INSERT INTO accounts VALUES('a',3,'writer-a'),('b',4,'writer-b')");
 const guard={sql:'p.id=? AND EXISTS(SELECT 1 FROM (SELECT ? AS wanted) AS __court_estate_guard_0 WHERE p.id=__court_estate_guard_0.wanted)',args:['a','a'],code:'ACCOUNT_CHANGED'};
 const estate={sql:'p.revision=? AND p.writer=?',args:[3,'writer-a']};
 let packed=withCourtEstateGuard(guard,context(estate));
 const selected=condition=>query(db,'SELECT p.id FROM accounts p WHERE '+condition.sql+' ORDER BY p.id',condition.args).map(row=>row.id);
 assert.deepEqual(selected(packed),selected(raw(guard,estate)));
 for(let i=0;i<3;i++){
  packed=withCourtEstateGuard(packed,context({sql:'p.id=? AND ? IS NULL',args:['a',null]}));
  assert.equal(packed.args.length,1);assert.equal(packed.code,'ACCOUNT_CHANGED');assert.deepEqual(selected(packed),['a']);
 }
 const other=withCourtEstateGuard({sql:'p.id=?',args:['b']},context({sql:'p.revision=?',args:[4]}));
 assert.deepEqual(selected({sql:'('+packed.sql+') OR ('+other.sql+')',args:[...packed.args,...other.args]}),['a','b']);
 assert.deepEqual(query(db,'UPDATE accounts AS p SET revision=revision+1 WHERE '+packed.sql+' RETURNING id',packed.args).map(row=>row.id),['a']);
 assert.deepEqual(selected(packed),[],'The correlated revision must be checked again after the update');
});

scope('quoted strings and identifiers and SQL comments retain literal question marks',db=>{
 db.exec('CREATE TABLE quoted("double?""quote" TEXT,[bracket?] TEXT,`backtick?` TEXT)');
 query(db,'INSERT INTO quoted VALUES(?,?,?)',['a','b','c']);
 const guard={sql:`?='quote''? :named @named $named ?17 literal'
  AND EXISTS(SELECT 1 FROM quoted WHERE "double?""quote"=? AND [bracket?]=? AND \`backtick?\`=?)
  /* preserve ? ?27 :named @named $named */ AND ?=?
  -- preserve ? ?27 :named @named $named
  AND ? IS NULL`,args:["quote'? :named @named $named ?17 literal",'a','b','c',7,7,null]};
 const estate={sql:"?='?'",args:['?']},packed=withCourtEstateGuard(guard,context(estate));
 assert.equal(packed.args.length,1);assert.equal(value(db,packed),1);assert.equal(value(db,raw(guard,estate)),1);
});

scope('a guard exceeding D1 raw parameter limits remains one parameter inside a receipt',db=>{
 const comparisons=75,guard={sql:Array(comparisons).fill('?=?').join(' AND '),args:Array.from({length:comparisons},(_,i)=>[i,i]).flat()},estate={sql:'? IS ?',args:[null,null]};
 const packed=withCourtEstateGuard(guard,context(estate));assert(guard.args.length>100);assert.equal(packed.args.length,1);assert.equal(value(db,packed),value(db,raw(guard,estate)));assert.equal(value(db,packed),1);
 db.exec('CREATE TABLE receipts(id TEXT PRIMARY KEY)');
 assert.equal(query(db,'INSERT INTO receipts SELECT ? WHERE '+packed.sql+' RETURNING id',['receipt-a',...packed.args])[0].id,'receipt-a');
});

scope('invalid contexts, unsupported values and mismatched or named bindings fail closed',()=>{
 assert.throws(()=>withCourtEstateGuard(safe,null),/Missing authoritative/);
 assert.throws(()=>withCourtEstateGuard(null,context(safe)),/Missing commit guard/);
 for(const value of [undefined,true,{},[],Infinity,-Infinity,NaN,1n])assert.throws(()=>withCourtEstateGuard({sql:'? IS NOT NULL',args:[value]},context(safe)),/Unsupported/);
 for(const sql of ['?1=1',':named=1','@named=1','$named=1'])assert.throws(()=>withCourtEstateGuard({sql,args:[1]},context(safe)),/anonymous SQL/);
 for(const sql of ['?=?','1=1'])assert.throws(()=>withCourtEstateGuard({sql,args:[1]},context(safe)),/binding count mismatch/);
});

console.log(JSON.stringify({ok:true,checks,queries,productionRequests:0},null,2));
