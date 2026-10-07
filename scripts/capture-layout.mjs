// Real Chromium/CDP, no packages, downloads, live sessions or live browser profile.
// Usage: CHROMIUM_PATH=/path/to/chrome node scripts/capture-layout.mjs
//    or: node scripts/capture-layout.mjs /path/to/chrome
// Writes screenshots, geometry.json and a throwaway profile to .test-output/layout-browser/.
import {spawn} from 'node:child_process';
import {mkdir, writeFile, appendFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {startServer} from '../src/server.mjs';
import {bubbleAnchor, desks, restPositions, standingBox, walls} from '../public/office_scene.mjs';
const chromium = process.argv[2] ?? process.env.CHROMIUM_PATH;
if (!chromium) {
  console.error('Usage: CHROMIUM_PATH=/path/to/chrome node scripts/capture-layout.mjs (or pass the path as an argument)');
  process.exit(2);
}
const out = new URL('../.test-output/layout-browser/', import.meta.url);
const profile = fileURLToPath(new URL(`profile-${Date.now()}/`, out));
await mkdir(profile, {recursive:true});
const fixture = new URL('synthetic.jsonl', out);
const message = (role, extra={}) => JSON.stringify({type:'message',message:{role,...extra}})+'\n';
await writeFile(fixture, message('assistant',{stopReason:'stop'}));
const app = await startServer({session:fileURLToPath(fixture),cwd:'/synthetic/workshop',interval:25});
const chrome = spawn(chromium,[
  '--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
  '--disable-background-networking','--disable-component-update','--no-first-run',
  '--no-default-browser-check','--disable-breakpad','--disable-crash-reporter',
  `--user-data-dir=${profile}`,'--remote-debugging-pipe','about:blank',
],{stdio:['ignore','ignore','pipe','pipe','pipe'],env:{...process.env,HOME:profile,XDG_CACHE_HOME:profile,XDG_CONFIG_HOME:profile}});
let serial=0, buffer='', stderr='';
const pending=new Map();
chrome.stderr.on('data',data=>{stderr+=data;});
chrome.stdio[4].on('data',data=>{
  buffer+=data;
  while(buffer.includes('\0')) {
    const end=buffer.indexOf('\0'), raw=buffer.slice(0,end); buffer=buffer.slice(end+1);
    if(!raw) continue;
    const m=JSON.parse(raw), waiter=pending.get(m.id);
    if(waiter) {pending.delete(m.id); m.error?waiter.reject(new Error(JSON.stringify(m.error))):waiter.resolve(m.result);}
  }
});
function send(method,params={},sessionId) {
  return new Promise((resolve,reject)=>{
    const id=++serial, timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP timeout ${method}: ${stderr.slice(-1000)}`));},15000);
    pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});
    chrome.stdio[3].write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0');
  });
}
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const reports=[];
try {
  const {targetId}=await send('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
  const c=(method,params)=>send(method,params,sessionId);
  const evaluate=async expression=>{
    const r=await c('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if(r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  await c('Page.enable');
  await c('Network.enable');
  await c('Network.setBlockedURLs',{urls:['https://*','http://raw.githubusercontent.com/*']});
  await c('Page.addScriptToEvaluateOnNewDocument',{source:`
    let clock=0, id=0; const frames=new Map();
    performance.now=()=>clock;
    window.requestAnimationFrame=fn=>{frames.set(++id,fn);return id;};
    window.cancelAnimationFrame=id=>frames.delete(id);
    window.__advance=count=>{for(let i=0;i<count;i++){clock+=100;const batch=[...frames.values()];frames.clear();for(const fn of batch)fn(clock);}};
  `});
  await c('Emulation.setDeviceMetricsOverride',{width:1040,height:700,deviceScaleFactor:1,mobile:false});
  await c('Page.navigate',{url:app.url});
  for(let i=0;i<100;i++) {
    if(await evaluate(`document.querySelector('#connection')?.textContent==='connected' && document.querySelectorAll('.bubble').length===4`)) break;
    await sleep(50);
  }
  async function capture(name,width,height,compact=false) {
    await c('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await evaluate(`if((document.querySelector('#compact').getAttribute('aria-pressed')==='true')!==${compact})document.querySelector('#compact').click()`);
    await sleep(100);
    await evaluate('window.__advance(0)');
    const geometry=await evaluate(`(()=>{
      const scene=document.querySelector('.scene').getBoundingClientRect(), scale=scene.width/640;
      return {scale,bubbles:[...document.querySelectorAll('.bubble')].map(el=>{
        const b=el.getBoundingClientRect(); return {text:el.textContent,visible:getComputedStyle(el).display!=='none',position:JSON.parse(el.dataset.position),phase:el.dataset.phase,away:el.dataset.away==='true',moving:el.dataset.moving==='true',box:[(b.x-scene.x)/scale,(b.y-scene.y)/scale,b.width/scale,b.height/scale],sizes:[el.scrollWidth,el.clientWidth,el.scrollHeight,el.clientHeight],overflow:el.scrollHeight>el.clientHeight || el.scrollWidth>el.clientWidth,font:getComputedStyle(el).font};
      })};
    })()`);
    const obstacles=[...walls,...desks.flatMap(d=>[[d.x,d.y+58,108,56],[d.x+30,d.y+32,48,44]]),
      ...geometry.bubbles.map(b=>standingBox(b.position)),[130,56,40,76], [32,108,52,60],
      [166,262,28,56],[300,72,120,70],[460,72,120,70],[492,266,104,70],[492,358,100,32],
      [44,34,126,16],[300,34,60,16],[122,328,84,16],[480,244,70,16]];
    const overlaps=([x,y,w,h],[a,b,c,d])=>x<a+c&&x+w>a&&y<b+d&&y+h>b;
    geometry.bubbles.forEach((bubble,i)=>{
      const role=desks[i].id;
      if (!bubble.visible) {
        assert.equal(bubble.phase,'rest');
        assert.equal(bubble.text,`${role[0].toUpperCase()+role.slice(1)}\nResting`);
        return;
      }
      const slot=bubbleAnchor(role,{position:bubble.position,phase:bubble.phase,away:bubble.away,moving:bubble.moving});
      assert.ok(bubble.box[3]<=slot[3]+.1,`${name}: ${bubble.text} exceeds local height: ${bubble.box} ${bubble.font}`);
      assert.equal(bubble.overflow,false,`${name}: overflow ${bubble.text} ${bubble.box} ${bubble.font} ${bubble.sizes}`);
      const [x,y,w,h]=bubble.box, [a,b,c,d]=standingBox(bubble.position);
      assert.ok(Math.hypot(Math.max(a-x-w,x-a-c,0),Math.max(b-y-h,y-b-d,0))<=46,`${name}: remote ${bubble.text}`);
      assert.ok(x>=20 && y>=24 && x+w<=620.1 && y+h<=408.1);
      for(const obstacle of obstacles) assert.equal(overlaps(bubble.box,obstacle),false,`${name}: ${bubble.text} over ${obstacle}`);
      for(const other of geometry.bubbles.slice(i+1).filter(b=>b.visible)) assert.equal(overlaps(bubble.box,other.box),false,'labels remain distinct');
    });
    const {data}=await c('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
    await writeFile(new URL(`${name}.png`,out),Buffer.from(data,'base64'));
    reports.push({name,...geometry});
  }
  await evaluate('__advance(1)');
  await capture('idle-1x',1040,700);
  const idle=reports.at(-1).bubbles.slice(1);
  assert.ok(idle.every(b=>!b.visible));
  const xs=idle.map(b=>b.position[0]);
  assert.ok(Math.max(...xs)-Math.min(...xs)<=96,'common rest group');
  for (const b of idle) assert.ok(Math.hypot(b.position[0]+16-180,b.position[1]+36-290)<=136,'water proximity');
  await capture('idle-2x',1700,1000);
  await capture('idle-compact',664,484,true);
  // Each explicit event goes through the real JSONL tail, status adapter and SSE.
  await appendFile(fixture,message('assistant',{stopReason:'toolUse',content:[{type:'toolCall',id:'synthetic-call',name:'subagent_run',arguments:{agent:'gentle-ai-worker'}}]}));
  await sleep(200); await evaluate('__advance(120)');
  await capture('working-1x',1040,700);
  await appendFile(fixture,message('toolResult',{toolCallId:'synthetic-call',details:{status:'running'}}));
  await sleep(200); await evaluate('__advance(1)');
  assert.ok((await evaluate(`document.querySelector('.bubbles').textContent`)).includes('Unconfirmed'));
  await capture('unknown-compact',664,484,true);
  assert.deepEqual(reports.at(-1).bubbles[2].position,[218,302],'unknown Writer remains at desk');
  await capture('unknown-2x',1700,1000);
  await appendFile(fixture,message('toolResult',{toolCallId:'synthetic-call',details:{status:'failed'}}));
  await sleep(200); await evaluate('__advance(48)');
  assert.ok((await evaluate(`document.querySelector('.bubbles').textContent`)).includes('Error received'));
  await capture('delivery-1x',1040,700);
  assert.deepEqual(reports.at(-1).bubbles[2].position,[210,108],'delivery at visitor, not remote board');
  await capture('delivery-2x',1700,1000);
  // Real text measurement for every terminal label, long memory text and counts.
  for(const text of ['Result received','Task cancelled','Needs attention','Partial result','Unconfirmed','Delegated · 12']) {
    await evaluate(`document.querySelectorAll('.bubble').forEach((el,i)=>{if(i===2)el.textContent='Writer\\n'+${JSON.stringify(text)};if(i===0)el.textContent='Saving to memory';})`);
    await capture(`text-${text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-')}`,664,484,true);
  }
  await appendFile(fixture,message('assistant',{stopReason:'toolUse',content:[
    {type:'toolCall',id:'all-scout',name:'subagent_run',arguments:{agent:'gentle-ai-explore'}},
    {type:'toolCall',id:'all-writer',name:'subagent_run',arguments:{agent:'gentle-ai-worker'}},
    {type:'toolCall',id:'all-verifier',name:'subagent_run',arguments:{agent:'gentle-ai-verify'}},
  ]}));
  await sleep(200); await evaluate('__advance(500)');
  await capture('active-workers-1x',1040,700);
  await capture('active-workers-2x',1700,1000);
  await capture('active-workers-compact',664,484,true);
  assert.equal(reports.at(-1).bubbles[1].phase,'stacks');
  assert.ok(reports.at(-1).bubbles.every(b=>b.visible));
  await appendFile(fixture,message('toolResult',{toolCallId:'all-scout',details:{status:'running'}}));
  await sleep(200); await evaluate('__advance(1)');
  await capture('unknown-scout-compact',664,484,true);
  // Headless Chromium supports a genuine Document PiP target on this build.
  await evaluate('__advance(1)');
  const beforePip=await send('Target.getTargets');
  await c('Runtime.evaluate',{expression:`document.querySelector('#pip').click()`,userGesture:true,awaitPromise:true});
  await sleep(500);
  const targets=await send('Target.getTargets');
  const pipTarget=targets.targetInfos.find(t=>!beforePip.targetInfos.some(b=>b.targetId===t.targetId));
  if(pipTarget) {
    const {sessionId:pipSession}=await send('Target.attachToTarget',{targetId:pipTarget.targetId,flatten:true});
    const nativeSize=await send('Runtime.evaluate',{expression:'({width:innerWidth,height:innerHeight})',returnByValue:true},pipSession);
    const clamped=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true},pipSession);
    await writeFile(new URL('native-pip-clamped.png',out),Buffer.from(clamped.data,'base64'));
    // Headless screen policy clamps the native window. Exercise the requested
    // viewport in that same genuine PiP target, without claiming OS sizing proof.
    await send('Emulation.setDeviceMetricsOverride',{width:664,height:484,deviceScaleFactor:1,mobile:false},pipSession);
    await sleep(150);
    const measured=await send('Runtime.evaluate',{expression:`(()=>{const scene=document.querySelector('.scene').getBoundingClientRect();return {width:innerWidth,height:innerHeight,sceneWidth:scene.width,bubbles:[...document.querySelectorAll('.bubble')].map(el=>{const b=el.getBoundingClientRect();return {text:el.textContent,box:[b.x-scene.x,b.y-scene.y,b.width,b.height]};})};})()`,returnByValue:true},pipSession);
    assert.ok(!measured.exceptionDetails,'PiP contains the actual reparented office');
    const geometry=measured.result.value;
    assert.equal(geometry.sceneWidth,640);
    geometry.bubbles.forEach(b=>assert.ok(b.box[3]<=32.1,'local labels fit in PiP'));
    const {data}=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true},pipSession);
    await writeFile(new URL('native-pip.png',out),Buffer.from(data,'base64'));
    await send('Target.closeTarget',{targetId:pipTarget.targetId});
    await sleep(100);
    assert.equal(await evaluate(`!!document.querySelector('#office')`),true,'PiP restores office');
    reports.push({pip:'Native Document PiP captured, then viewport emulated at 664x484 because headless clamps native sizing; close restored the office.',nativeSize:nativeSize.result.value,...geometry});
  } else reports.push({pip:'Native Document PiP unavailable in this headless build; compact is viewport evidence only.',button:await evaluate(`document.querySelector('#pip').title`)});
  await writeFile(new URL('geometry.json',out),JSON.stringify(reports,null,2)+'\n');
  console.log(`Captured ${reports.length-1} main-page HTML screenshots plus native PiP evidence; geometry assertions passed.`);
} finally {
  try {await send('Browser.close');} catch {}
  await app.close();
}
