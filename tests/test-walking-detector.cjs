const assert=require('node:assert/strict');
const {createDetector}=require('../walking.js');
let checks=0;
function test(name,fn){fn();checks++;console.log('PASS '+name);}
const sample=(time,z=9.81,x=0,y=0)=>({timeMs:time,accelerationIncludingGravity:{x,y,z}});
function signal(detector,{from=0,to=10000,period=620,amplitude=2.8,linear=false,orientation=false,noise=0}={}){
 let accepted=0;
 for(let time=from;time<=to;time+=20){const wave=amplitude*Math.sin(2*Math.PI*(time-from)/period),jitter=noise*Math.sin(time*1.37),value=9.81+wave+jitter;
  const input=linear?{timeMs:time,acceleration:{x:Math.max(0,wave),y:0,z:0}}:orientation?sample(time,value*Math.cos(time/500),value*Math.sin(time/500)):sample(time,value);
  accepted+=detector.push(input).steps;
 }
 return accepted;
}
test('a steady walking cadence confirms the first three peaks then counts subsequent steps',()=>{
 const detector=createDetector(),count=signal(detector);
 assert(count>=12&&count<=15,`Expected a conservative ten-second walking estimate, got ${count}`);assert.equal(detector.getState().totalSteps,count);assert(detector.getState().cadence>80&&detector.getState().cadence<115);
});
test('a stationary device and orientation changes alone never create steps',()=>{
 for(const orientation of [false,true]){const detector=createDetector();assert.equal(signal(detector,{amplitude:0,noise:0.12,orientation}),0);}
});
test('one or two isolated shakes never pass the continuous-walking confirmation',()=>{
 for(const peaks of [1,2]){const detector=createDetector();for(let time=0;time<1200;time+=20)detector.push(sample(time));let count=0;
  for(let time=1200;time<5000;time+=20){const offset=time-1200,active=offset<peaks*650;count+=detector.push(sample(time,9.81+(active?3*Math.sin(offset/650*Math.PI*2):0))).steps;}
  assert.equal(count,0);
 }
});
test('rapid vibration is rejected instead of counting every second oscillation',()=>{assert.equal(signal(createDetector(),{period:160,amplitude:3.4}),0);});
test('impossible spikes, missing values, strings and repeated or backward times are ignored',()=>{
 const detector=createDetector();assert.equal(detector.push(sample(1000)).valid,true);
 for(const value of [sample(1000,14),sample(999,14),sample(1100,100),{timeMs:1100,accelerationIncludingGravity:{x:null,y:0,z:9.81}},{timeMs:1100,accelerationIncludingGravity:{x:0,y:0,z:'9.81'}},{timeMs:NaN},{}]){const result=detector.push(value);assert.equal(result.steps,0);assert.equal(result.valid,false);}
 assert.equal(detector.getState().totalSteps,0);
});
test('foreground gaps and explicit resets require a fresh calibration and cadence',()=>{
 const detector=createDetector();assert(signal(detector)>0);const previous=detector.getState().totalSteps;
 assert.equal(detector.push(sample(30000,12)).steps,0);assert.equal(detector.getState().phase,'calibrating');assert.equal(detector.getState().totalSteps,previous);
 detector.reset();assert.equal(detector.getState().totalSteps,0);assert.equal(detector.push(sample(30100,12)).steps,0);
});
test('rotated walking and acceleration-only hardware still produce bounded estimates',()=>{
 for(const options of [{orientation:true},{linear:true}]){const count=signal(createDetector(),options);assert(count>=8&&count<=16,`Expected detectable walking with ${JSON.stringify(options)}, got ${count}`);}
});
console.log(`${checks} pure motion detector checks passed. No synthetic browser events or network requests.`);
