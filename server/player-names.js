// Display names are historical account data; name_key is only a reservation.
// The release namespace cannot be entered through textField (U+0001 is denied).
export const playerNameKey = name => name.normalize('NFKC').toLocaleLowerCase('ja');
export const releasedPlayerNameKey = id => '\u0001released:' + id;
export const playerNameReleased = row => !!row.ban_active || !!row.expulsion_pending || row.name_key === releasedPlayerNameKey(row.id);
export const playerNameConflict = error => /unique[^]*users\.name_key/i.test(String(error));
export const PLAYER_NAME_TAKEN = 'その領主名は現在ほかのプレイヤーが使用しています。別の領主名を入力してください。';
const inactiveNameOwner = 'EXISTS(SELECT 1 FROM player_bans b WHERE b.user_id=users.id AND b.active=1) OR EXISTS(SELECT 1 FROM player_expulsions e WHERE e.user_id=users.id AND e.pending=1)';

// Older sanctions may predate the release triggers. Repair only the requested
// indexed reservation, within the successful claim's own transaction and gate.
export function releaseInactivePlayerNameStatement(db,name,gate='1=1',args=[]){
 return db.prepare(`UPDATE users SET name_key=char(1)||'released:'||id WHERE name_key=? AND (${inactiveNameOwner}) AND (${gate})`).bind(playerNameKey(name),...args);
}

export async function requireAvailablePlayerName(db,id,name,fail){
 const owner=await db.prepare(`SELECT id FROM users WHERE name_key=? AND id<>? AND NOT (${inactiveNameOwner})`).bind(playerNameKey(name),id).first();
 if(owner)fail(409,'NAME_TAKEN',PLAYER_NAME_TAKEN);
}
