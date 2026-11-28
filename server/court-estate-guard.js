// Bind the shared holding timeline to the same commit as its personal effects.
// The projection itself never becomes part of a player's saved campaign.
export function withCourtEstateGuard(guard,context){
 if(!context?.guard||typeof context.guard.sql!=='string'||!Array.isArray(context.guard.args))throw new Error('Missing authoritative court estate context');
 return{...guard,sql:`(${guard.sql}) AND (${context.guard.sql})`,args:[...guard.args,...context.guard.args]};
}
