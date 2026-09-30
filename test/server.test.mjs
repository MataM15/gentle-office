import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, writeFile, appendFile, readFile, stat, symlink} from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {startServer, sourceRevision} from '../src/server.mjs';
import {root, user, call, result, final, line} from './helpers/fixtures.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const endpoint = (app, pathname) => { const url = new URL(app.url); url.pathname=pathname; return url; };
const register = (app, data) => fetch(endpoint(app, '/sessions'), {method:'POST',body:JSON.stringify(data)});
async function hubFixture(name, options={}) {
  const sessionRoot=path.join(root, name, 'sessions'), stateFile=path.join(root,name,'state','hub.json');
  await mkdir(sessionRoot,{recursive:true});
  const files=[];
  for(let i=0;i<9;i++) { const file=path.join(sessionRoot,`${i}.jsonl`); await writeFile(file,line(user)); files.push(file); }
  const app=await startServer({hub:true,sessionRoot,stateFile,interval:15,...options});
  return {app,files,stateFile,sessionRoot};
}

test('hub validates registrations, bounds input and capacity, and is idempotent', async () => {
  const {app,files,sessionRoot}=await hubFixture('hub-validation');
  const data={file:files[0],cwd:'/private/project',owner:process.pid};
  try {
    for(const patch of [{file:'relative.jsonl'},{file:path.join(root,'outside.jsonl')},{file:files[0].replace('.jsonl','.txt')},
      {file:path.join(sessionRoot,'missing.jsonl')},{owner:0},{owner:-1},{owner:1.2},{owner:'123'},{owner:2147483648},{cwd:null}]) {
      assert.equal((await register(app,{...data,...patch})).status,400);
    }
    const outside=path.join(root,'outside.jsonl');await writeFile(outside,line(user));
    assert.equal((await register(app,{...data,file:outside})).status,400);
    const link=path.join(sessionRoot,'escape.jsonl');
    try {await symlink(outside,link);} catch(e) {if(e.code!=='EEXIST')throw e;}
    assert.equal((await register(app,{...data,file:link})).status,400);
    assert.equal((await fetch(endpoint(app,'/sessions'),{method:'POST',body:'x'.repeat(4097)})).status,400);
    assert.equal((await fetch(endpoint(app,'/sessions'),{method:'POST',body:'{'})).status,400);
    const first=await (await register(app,data)).json();
    assert.deepEqual(await (await register(app,data)).json(),first);
    const results=await Promise.all(files.slice(1).map(file=>register(app,{...data,file})));
    assert.equal(results.filter(r=>r.status===200).length,7);
    assert.equal(results.filter(r=>r.status===400).length,1);
    assert.deepEqual(await (await register(app,data)).json(),first);
    assert.equal(app.snapshot().offices.length,8);
    assert.equal((await fetch(endpoint(app,`/sessions/${first.id}`),{method:'DELETE'})).status,204);
    assert.equal(app.snapshot().offices.length,7);
    assert.equal((await fetch(endpoint(app,`/sessions/${first.id}`),{method:'DELETE'})).status,404);
    const naked=endpoint(app,'/sessions');naked.search='';
    assert.equal((await fetch(naked,{method:'POST',body:JSON.stringify(data)})).status,403);
  } finally {await app.close();}
});

test('hub SSE contains separate private snapshots and state has restrictive permissions', async () => {
  const {app,files,stateFile}=await hubFixture('hub-sse');
  const abort=new AbortController();
  try {
    const state=JSON.parse(await readFile(stateFile,'utf8'));
    assert.deepEqual(state,{url:app.url,port:Number(new URL(app.url).port),pid:process.pid});
    assert.equal((await stat(stateFile)).mode & 0o777,0o600);
    assert.equal((await stat(path.dirname(stateFile))).mode & 0o777,0o700);
    for(const [i,file] of files.slice(0,2).entries()) await register(app,{file,cwd:`/private/project-${i}`,owner:process.pid});
    const response=await fetch(endpoint(app,'/events'),{signal:abort.signal});
    const text=new TextDecoder().decode((await response.body.getReader().read()).value);
    const payload=JSON.parse(text.slice(6));
    assert.equal(payload.offices.length,2);
    assert.deepEqual(payload.offices.map(o=>o.cwd),['project-0','project-1']);
    assert.notEqual(payload.offices[0].id,payload.offices[1].id);
    assert.doesNotMatch(text,/private|jsonl|owner|PRIVATE|file/);
  } finally {abort.abort();await app.close();}
  await assert.rejects(readFile(stateFile),{code:'ENOENT'});
});

test('hub removes dead owners and only exits after a registered empty grace period', async () => {
  const {app,files,stateFile}=await hubFixture('hub-empty',{exitWhenEmpty:true,emptyDelay:90});
  try {
    await sleep(120);assert.equal(await request(app.url),200);
    const data={file:files[0],cwd:'/project',owner:process.pid};
    let {id}=await (await register(app,data)).json();
    await fetch(endpoint(app,`/sessions/${id}`),{method:'DELETE'});
    await sleep(35);assert.equal(await request(app.url),200);
    ({id}=await (await register(app,data)).json());
    await sleep(110);assert.equal(await request(app.url),200);
    await register(app,{...data,owner:2147483647});
    await sleep(45);assert.equal(app.snapshot().offices.length,0);
    assert.equal(await request(app.url),200);
    await sleep(120);await assert.rejects(fetch(app.url));
    await assert.rejects(readFile(stateFile),{code:'ENOENT'});
  } finally {await app.close();}
});

test('hub close preserves state replaced by another pid', async () => {
  const {app,stateFile}=await hubFixture('hub-state-owner');
  try {await writeFile(stateFile,JSON.stringify({pid:2147483647}));}
  finally {await app.close();}
  assert.equal(JSON.parse(await readFile(stateFile,'utf8')).pid,2147483647);
});

test('restart retains transport, every registration ID and ownership without exporting paths', async () => {
  const {app,files,stateFile}=await hubFixture('hub-restart');
  try {
    const ids=[];
    for(const file of files.slice(0,8)) ids.push((await (await register(app,{file,cwd:'/project',owner:process.pid})).json()).id);
    const before=await (await fetch(endpoint(app,'/control/status'))).json();
    assert.equal(before.revision,await sourceRevision());
    const state=await readFile(stateFile,'utf8');
    const abort=new AbortController();
    const stream=await fetch(endpoint(app,'/events'),{signal:abort.signal});
    const reader=stream.body.getReader();await reader.read();
    assert.equal((await fetch(endpoint(app,'/control/restart'),{method:'POST'})).status,200);
    abort.abort();
    const after=await (await fetch(endpoint(app,'/control/status'))).json();
    assert.notEqual(after.generation,before.generation);
    assert.equal(after.sessions,8);
    assert.equal(await readFile(stateFile,'utf8'),state);
    assert.deepEqual(app.snapshot().offices.map(o=>o.id),ids);
    assert.doesNotMatch(JSON.stringify(after),/jsonl|owner|file|token|PRIVATE/);
    // Existing extension ownership handles remain usable across multiple reloads.
    assert.equal((await fetch(endpoint(app,'/control/restart'),{method:'POST'})).status,200);
    for(const id of ids) assert.equal((await fetch(endpoint(app,`/sessions/${id}`),{method:'DELETE'})).status,204);
    assert.equal(app.snapshot().offices.length,0);
  } finally {await app.close();}
});

test('loaded revision stays fixed until reload, and invalid replacement leaves the old hub usable', async () => {
  const dir=path.join(root,'reload-source');
  for(const sub of ['src','public']) await mkdir(path.join(dir,sub),{recursive:true});
  for(const name of ['src/server.mjs','src/status.mjs','public/index.html','public/app.mjs','public/layout.mjs','public/office_scene.mjs','public/style.css','public/avatar.svg'])
    await writeFile(path.join(dir,name),await readFile(new URL(`../${name}`,import.meta.url)));
  const module=await import(pathToFileURL(path.join(dir,'src','server.mjs')));
  const {files,sessionRoot,stateFile,app:setup}=await hubFixture('reload-version');await setup.close();
  const app=await module.startServer({hub:true,sessionRoot,stateFile,interval:15});
  const getStatus=async()=> (await fetch(endpoint(app,'/control/status'))).json();
  try {
    const {id}=await (await register(app,{file:files[0],cwd:'/project',owner:process.pid})).json();
    const before=await getStatus();
    const original=await readFile(path.join(dir,'src','server.mjs'),'utf8');
    await writeFile(path.join(dir,'src','server.mjs'),'not valid javascript !!!');
    assert.equal((await fetch(endpoint(app,'/control/restart'),{method:'POST'})).status,500);
    assert.equal((await getStatus()).generation,before.generation);
    assert.equal(await request(app.url),200);
    await writeFile(path.join(dir,'src','server.mjs'),original+'\n// updated fixture\n');
    assert.notEqual(await module.sourceRevision(),before.revision);
    assert.equal((await getStatus()).revision,before.revision);
    // A cache-busted import from a CLI-started hub must not execute the CLI again.
    // Replace that branch with a sentinel in this isolated fixture, never a real spawn.
    const guarded=(original+'\n// updated fixture\n').replace('const app=await startServer(options);console.log(app.url);',
      'throw new Error("CLI executed during reload");');
    await writeFile(path.join(dir,'src','server.mjs'),guarded);
    const entry=process.argv[1];process.argv[1]=path.join(dir,'src','server.mjs');
    try {assert.equal((await fetch(endpoint(app,'/control/restart'),{method:'POST'})).status,200);}
    finally {process.argv[1]=entry;}
    assert.equal((await getStatus()).revision,await module.sourceRevision());
    assert.equal((await fetch(endpoint(app,`/sessions/${id}`),{method:'DELETE'})).status,204);
  } finally {await app.close();}
});

test('restart control rejects missing capability, wrong Host, origin, payload and wrong method', async () => {
  const {app}=await hubFixture('hub-restart-auth');
  try {
    const control=endpoint(app,'/control/restart');
    const naked=new URL(control);naked.search='';
    assert.equal((await fetch(naked,{method:'POST'})).status,403);
    assert.equal(await request(endpoint(app,'/control/status'),'evil.example'),403);
    assert.equal((await fetch(control,{method:'POST',headers:{Origin:'http://evil.example'}})).status,400);
    assert.equal((await fetch(control,{method:'POST',body:'x'})).status,400);
    assert.equal((await fetch(control)).status,404);
    const responses=await Promise.all([fetch(control,{method:'POST'}),fetch(control,{method:'POST'})]);
    assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  } finally {await app.close();}
});

const request = (url, host) => new Promise((resolve, reject) => {
  http.get(url, {headers:host ? {Host:host} : {}}, res => {
    res.resume();
    res.on('end', () => resolve(res.statusCode));
  }).on('error', reject);
});

test('loopback HTTP capability, Host, assets, SSE and cleanup', async () => {
  const file = path.join(root, 'server.jsonl');
  await writeFile(file, line(user) + line(call('subagent_run', 'a', {
    agent:'gentle-ai-worker', task:'Build a component.',
  })));
  const app = await startServer({session:file, cwd:'/test/project', interval:30});
  const abort = new AbortController();
  try {
    assert.equal(await request(app.url), 200);
    const naked = new URL(app.url);
    naked.search = '';
    assert.equal(await request(naked), 403);
    assert.equal(await request(app.url, 'evil.example'), 403);
    assert.equal(await request(app.url, 'localhost'), 403);
    const page = await (await fetch(app.url)).text();
    assert.match(page, /Gentle Office/);
    assert.doesNotMatch(page, /__TOKEN__/);
    const asset = new URL(app.url);
    asset.pathname = '/app.mjs';
    assert.equal((await fetch(asset)).status, 200);
    asset.pathname = '/events';
    const res = await fetch(asset, {signal:abort.signal});
    const reader = res.body.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    assert.match(first, /Build a component/);
    await appendFile(file, line(result('a')) + line(final));
    await new Promise(r => setTimeout(r, 120));
    assert.equal(app.snapshot().offices[0].orchestrator.working, false);
    assert.equal(app.snapshot().offices[0].id, 'single');
    abort.abort();
  } finally {
    abort.abort();
    await app.close();
  }
  await assert.rejects(fetch(app.url));
});

test('missing session is honest', async () => {
  const app = await startServer({session:path.join(root, 'missing.jsonl')});
  try { assert.equal(app.snapshot().offices[0].session, false); }
  finally { await app.close(); }
});
