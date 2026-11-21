import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
// Test the exact dependency-free parser shipped in the single-file Worker.
const workerSource=readFileSync(new URL('./index.js',import.meta.url),'utf8');
const parserStart=workerSource.indexOf('function normalizeAvatarJpeg(input) {'),parserEnd=workerSource.indexOf('\nfunction mapUser(',parserStart);
assert(parserStart>0&&parserEnd>parserStart);
const normalizeAvatarJpeg=Function('return ('+workerSource.slice(parserStart,parserEnd)+')')();

const directory=fileURLToPath(new URL('./fixtures/avatar/',import.meta.url));
let checks=0;
const check=fn=>{fn();checks++;};
const read=name=>new Uint8Array(readFileSync(directory+name+'.jpg'));
const join=(...parts)=>new Uint8Array(Buffer.concat(parts.map(part=>Buffer.from(part))));
const seg=(marker,payload)=>join([255,marker,(payload.length+2)>>8,(payload.length+2)&255],payload);
function markers(input){
 const found=[];let at=2;
 while(at<input.length){const start=at;assert.equal(input[at++],255);while(input[at]===255)at++;const marker=input[at++];if(marker===217){found.push({marker,start,end:at});break;}const length=(input[at]<<8)|input[at+1],end=at+length;found.push({marker,start,end,payload:at+2});at=end;if(marker===218){while(at<input.length){if(input[at++]!==255)continue;const mark=at-1;while(input[at]===255)at++;const next=input[at];if(next===0||next>=208&&next<=215){at++;continue;}at=mark;break;}}}
 return found;
}
const baseline=read('baseline'),parsed=markers(baseline),sof=parsed.find(x=>x.marker===192),sos=parsed.find(x=>x.marker===218),dqt=parsed.find(x=>x.marker===219),dht=parsed.find(x=>x.marker===196);
for(const name of ['baseline','progressive','restart','restart-progressive','grayscale','grayscale-progressive']){
 const input=read(name),copy=input.slice(),clean=normalizeAvatarJpeg(input);
 check(()=>assert.deepEqual(input,copy));check(()=>assert.deepEqual(normalizeAvatarJpeg(clean),clean));check(()=>assert(!markers(clean).some(x=>x.marker>=224&&x.marker<=239||x.marker===254)));check(()=>assert.deepEqual(clean,read(name+'-clean'),'Matches the decoded-pixel-verified sanitized fixture'));
}
const privateText=new TextEncoder().encode('EXIF-GPS private-filename XMP ICC Adobe <script>not returned</script>');
const metadata=join(...Array.from({length:16},(_,i)=>seg(224+i,privateText)),seg(254,privateText));
const normal=normalizeAvatarJpeg(baseline);
for(const at of [2,sos.start,baseline.length-2]){
 const supplied=join(baseline.slice(0,at),metadata,baseline.slice(at));
 check(()=>assert.deepEqual(normalizeAvatarJpeg(supplied),normal));
}
const bad=fn=>{const bytes=baseline.slice();fn(bytes);return bytes;};
const rejected=[
 null,{},new Uint8Array(49153),new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'),
 new TextEncoder().encode('GIF89a'),new TextEncoder().encode('RIFF....WEBP'),
 read('oversize-dimension'),baseline.slice(1),baseline.slice(0,-1),join(baseline,[0]),join(baseline,[0,255,217]),
 join([60,115,118,103,62],baseline),
 bad(b=>{b[sof.payload]=12;}),bad(b=>{b[sof.payload+1]=0;}),bad(b=>{b[sof.payload+3]=0;}),
 bad(b=>{b[sof.payload+5]=4;}),bad(b=>{b[sof.payload+7]=0;}),bad(b=>{b[sof.payload+9]=b[sof.payload+6];}),
 bad(b=>{b[sof.start+1]=193;}),bad(b=>{b[dqt.start+2]=255;b[dqt.start+3]=255;}),
 bad(b=>{b[dqt.payload+1]=0;}),bad(b=>{b[dht.payload+1]=3;}),
 bad(b=>{b[sos.payload+1]=255;}),bad(b=>{b[sos.payload+2]=15;}),bad(b=>{b[sos.end-3]=1;}),
 join(baseline.slice(0,sos.start),baseline.slice(sof.start,sof.end),baseline.slice(sos.start)),
 join(baseline.slice(0,dqt.start),baseline.slice(dqt.end)),
 join(baseline.slice(0,sos.start),baseline.slice(sos.end)),
 join(baseline.slice(0,sos.end),[255,217]),
 join(baseline.slice(0,sos.end),[255,216],baseline.slice(sos.end)),
 join(baseline.slice(0,sos.end),[255,208],baseline.slice(sos.end)),
 join(baseline.slice(0,-2),seg(220,[1,0]),baseline.slice(-2)),
 join(baseline.slice(0,-2),seg(204,[0,0]),baseline.slice(-2))
];
for(const candidate of rejected)check(()=>assert.throws(()=>normalizeAvatarJpeg(candidate),/^Error: Invalid avatar JPEG$/));
const restarted=read('restart');let restartAt=-1;for(let i=0;i<restarted.length-1;i++)if(restarted[i]===255&&restarted[i+1]===208){restartAt=i;break;}assert(restartAt>0);restarted[restartAt+1]=211;check(()=>assert.throws(()=>normalizeAvatarJpeg(restarted)));
const progressive=read('progressive'),progressiveSOS=markers(progressive).find(x=>x.marker===218);progressive[progressiveSOS.end-1]=0x21;check(()=>assert.throws(()=>normalizeAvatarJpeg(progressive)));
const chrome=read('chrome-canvas');check(()=>assert.equal(chrome.length,41163));check(()=>assert(normalizeAvatarJpeg(chrome).length<=49152));
console.log(JSON.stringify({ok:true,checks,realJpegProfiles:7,source:'ITU-T T.81 Annex B/E',metadata:'all APP0-APP15 and COM removed',networkRequests:0},null,2));
