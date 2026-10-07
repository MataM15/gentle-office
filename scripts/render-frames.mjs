// Usage: node scripts/render-frames.mjs
// Writes PNG frames, contact.png and manifest.json to .test-output/movement-frames/.
// Mock raster canvas, not browser/HTML bubble evidence. No external dependencies.
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {deflateSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {context, rasterAvatar} from './lib/raster-canvas.mjs';
import {createScene, createWorkers, visitorPosition, fatigueMoment, writerThinking} from '../public/office_scene.mjs';
const out = new URL('../.test-output/movement-frames/', import.meta.url);
mkdirSync(out, {recursive:true});
const avatar = rasterAvatar(readFileSync(new URL('../public/avatar.svg', import.meta.url), 'utf8'));
function png(pixels, width, height) {
  const chunk = (name, data) => {
    const body = Buffer.concat([Buffer.from(name), data]);
    let crc = 0xffffffff;
    for (const b of body) { crc ^= b; for (let i=0;i<8;i++) crc = (crc>>>1)^((crc&1)?0xedb88320:0); }
    const size = Buffer.alloc(4), sum = Buffer.alloc(4);
    size.writeUInt32BE(data.length); sum.writeUInt32BE((crc^0xffffffff)>>>0);
    return Buffer.concat([size, body, sum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height,4); header[8]=8; header[9]=2;
  const rows = Buffer.alloc((width*3+1)*height);
  for (let y=0;y<height;y++) pixels.copy(rows, y*(width*3+1)+1, y*width*3, (y+1)*width*3);
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
const frames = [], metadata = [];
function capture(name, poses, extra={}) {
  const pixels = Buffer.alloc(640*432*3), ctx = context(pixels,avatar);
  createScene(ctx, 'avatar').render({agents:{orchestrator:{working:true,hand:1,phase:1}, ...poses}, ...extra});
  writeFileSync(new URL(`${name}.png`,out),png(pixels,640,432));
  frames.push(pixels); metadata.push({name,poses,...extra});
}
function advance(workers, seconds, active=[]) {
  let poses;
  for (let i=0;i<seconds*60;i++) poses = workers.step(1/60,active);
  return poses;
}
const scout = createWorkers();
capture('rest',scout.step(0));
scout.observe([{role:'scout',type:'arrival'}]);
capture('arrival',advance(scout,.4,['scout']));
capture('scout-journey',advance(scout,4.2,['scout']));
capture('stacks',advance(scout,15,['scout']));
const workers = createWorkers();
workers.observe([{role:'writer',type:'arrival'},{role:'verifier',type:'arrival'}]);
capture('work',advance(workers,8,['writer','verifier']));
workers.observe([{role:'writer',type:'result',state:'completed'}]);
let poses, visited = false, returning = false;
for (let i=0;i<3600;i++) {
  poses = workers.step(1/60,['verifier']);
  if (!visited && poses.writer.phase === 'pause') { visited = true; capture('delivery',poses,{time:2}); }
  if (visited && poses.writer.phase === 'pause' && poses.writer.position[0]<visitorPosition[0]-8) {
    returning = true; capture('return',poses); break;
  }
}
assert.ok(returning,'capture must reach genuine delivery return');
for (let i=0;i<60;i++) { workers.reset(); poses = workers.step(1/60); }
capture('reset-return',poses);
capture('rest-again',advance(workers,40));
// Role- and state-driven animation: seated poses are built by hand, with a clock.
const seated = extra => ({working:true, hand:1, bob:0, phase:1, ...extra});
const moment = (kind, id, seconds=120) => { for (let t=0;t<60;t+=.05) if (fatigueMoment(seconds,t,id) === kind) return t; };
const thinkAt = (() => { for (let t=0;t<60;t+=.05) if (writerThinking(t)) return t + .4; })();
const roles = {writer:seated({agentState:'delegated'}), scout:seated({agentState:'delegated'}), verifier:seated({agentState:'delegated'})};
capture('role-monitors', roles, {time:1.3});
capture('writer-thinks', {...roles, writer:seated({agentState:'delegated'})}, {time:thinkAt});
capture('tired-yawn', {writer:seated({activeSeconds:120})}, {time:moment('yawn','writer')});
capture('tired-stretch', {writer:seated({activeSeconds:120})}, {time:moment('stretch','writer')});
capture('verifier-passed', {verifier:seated({away:true, position:[300,187], outcome:'completed'}), writer:seated({outcome:'failed', away:true, position:[250,187]})}, {time:2});
capture('unknown-and-stacks', {writer:seated({agentState:'unknown'}),
  scout:{away:true, moving:false, phase:'stacks', position:[540,276], book:true, working:true, agentState:'unknown', activeSeconds:120},
  verifier:{away:true, moving:false, phase:'stacks', position:[582,276], book:true, working:true, agentState:'delegated'}}, {time:moment('yawn','scout')});
const react = (state, role='writer') => ({[role]:{away:true, moving:false, phase:'pause', position:visitorPosition, book:true, outcome:state, reaction:{state, t:.3}}});
capture('react-success', react('completed'), {time:2});
capture('react-failed', react('failed'), {time:2});
capture('react-blocked', react('blocked','verifier'), {time:2.2});
// Full-resolution panels, three per row; filenames/poses in manifest.json.
const rows = Math.ceil(frames.length/3);
const sheet = Buffer.alloc(1920*432*rows*3);
frames.forEach((pixels,n) => {
  for (let y=0;y<432;y++) pixels.copy(sheet,((Math.floor(n/3)*432+y)*1920+(n%3)*640)*3,y*640*3,(y+1)*640*3);
});
writeFileSync(new URL('contact.png',out),png(sheet,1920,432*rows));
writeFileSync(new URL('manifest.json',out),JSON.stringify({canvas:'mock raster; no HTML overlays',panels:metadata},null,2)+'\n');
console.log(`Rendered ${frames.length} current frames and contact.png (row-major manifest.json).`);
