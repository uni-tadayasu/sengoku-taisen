import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';

// Isolated failures: no production requests, credentials, SQL or user values
// may appear in diagnostics, even when the exception itself contains them.
const h=harness(),logs=[],originalError=console.error;
const privateText='synthetic-private-value-never-log',responseText='通信処理に失敗しました。少し時間をおいて再度お試しください。';
console.error=value=>logs.push(String(value));
function failure(message,name='Error'){
 const error=new Error(message+' '+privateText);error.name=name;
 error.stack=`${name}: ${privateText}\n    at helper (https://private.invalid/${privateText}/index.js:123:45)\n    at ${privateText} (private-file.js:88:1)`;
 return error;
}
try{
 const actor=await h.session('診断専用の非公開名');
 for(const [marker,stage,message,category,name] of [
  ['player-evaluation','evaluations','D1_ERROR: too many SQL variables','database_limit'],
  ['public-court-office','public-court','unexpected value','runtime_type','TypeError'],
  ['public-city-honors','public-honors','D1_ERROR: malformed JSON','database_json']
 ]){
  h.beforeBatch=statements=>{if(statements.some(statement=>statement.sql.includes(marker)))throw failure(message,name);};
  const result=await h.api('/me',{token:actor.token,expected:500}),record=JSON.parse(logs.at(-1));
  assert.equal(result.data.error.code,'INTERNAL_ERROR');assert.equal(result.data.error.message,responseText);
  assert.equal(record.event,'sengoku_internal_failure');assert.equal(record.route,'/me');assert.equal(record.stage,stage);assert.equal(record.category,category);
  assert.deepEqual(record.frames,[{source:'index.js',line:123,column:45}]);
 }
 h.beforeBatch=null;
 h.beforeStatement=query=>{if(query.includes('INSERT INTO rate_limits'))throw failure('D1_ERROR: no such table: deputy_operator_state');};
 await h.api('/admin/recover',{method:'POST',body:{key:privateText,requestId:crypto.randomUUID()},expected:500});
 const routeRecord=JSON.parse(logs.at(-1));assert.equal(routeRecord.route,'/admin/recover');assert.equal(routeRecord.stage,'route');assert.equal(routeRecord.category,'database_schema');assert.equal(routeRecord.schema,'deputy_operator_state');
 h.beforeStatement=query=>{if(query.includes('INSERT INTO rate_limits'))throw failure('D1_ERROR: no such table: '+privateText);};
 await h.api('/admin/recover',{method:'POST',body:{key:privateText,requestId:crypto.randomUUID()},expected:500});assert.equal(JSON.parse(logs.at(-1)).schema,undefined);
 h.beforeStatement=null;const count=logs.length;
 await h.api('/admin/recover',{method:'POST',body:{key:privateText,requestId:crypto.randomUUID()},expected:403});assert.equal(logs.length,count,'expected authentication errors are not diagnostics');
 const output=logs.join('\n');for(const secret of [privateText,actor.token,actor.user.id,'診断専用の非公開名','private.invalid','INSERT INTO','SELECT ','Bearer'])assert(!output.includes(secret),'diagnostics must not contain '+secret.slice(0,12));
 assert.equal(logs.length,5);
 console.log('Internal diagnostic tests passed: route and decorator stages, bounded categories/schema identifiers, numeric source positions, private-value exclusion and unchanged public errors. No external requests.');
}finally{console.error=originalError;h.close();}
