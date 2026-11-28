// Bind the shared holding timeline to the same commit as its personal effects.
// The projection itself never becomes part of a player's saved campaign.
const SQL_TOKENS=/'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|--[^\r\n]*|\/\*[\s\S]*?\*\/|\?[0-9]*|[:@$][A-Za-z_][A-Za-z0-9_]*/g;
export function withCourtEstateGuard(guard,context){
 if(!context?.guard||typeof context.guard.sql!=='string'||!Array.isArray(context.guard.args))throw new Error('Missing authoritative court estate context');
 if(!guard||typeof guard.sql!=='string'||!Array.isArray(guard.args))throw new Error('Missing commit guard');
 const condition=`(${guard.sql}) AND (${context.guard.sql})`,args=[...guard.args,...context.guard.args];
 if(args.some(value=>value!==null&&typeof value!=='string'&&!(typeof value==='number'&&Number.isFinite(value))))throw new Error('Unsupported court estate guard binding');
 if(!args.length)return{...guard,sql:condition,args:[]};
 // Battle receipts combine both players' clock, branch, residency and role
 // fences. Bind their complete guard as one JSON row so a winning battle's
 // additional succession fence cannot exceed D1's 100-parameter limit.
 // A fresh scope also permits a previously packed guard to be wrapped again.
 let suffix=0,scope;do{scope='__court_estate_guard_'+suffix++;}while(condition.toLowerCase().includes(scope));
 const column=scope+'_json';let index=0;
 const packed=condition.replace(SQL_TOKENS,token=>{
  if(!/^[?:@$]/.test(token))return token; // Preserve quoted SQL and comments.
  if(token!=='?')throw new Error('Court estate guards require anonymous SQL bindings');
  return `json_extract(${scope}.${column},'$[${index++}]')`;
 });
 if(index!==args.length)throw new Error('Court estate guard binding count mismatch');
 // A scalar SELECT retains NULL/false semantics and outer table correlations.
 return{...guard,sql:`(SELECT (${packed}) FROM (SELECT ? AS ${column}) AS ${scope})`,args:[JSON.stringify(args)]};
}
