import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {sourceRevision} from '../src/server.mjs';
import {fileURLToPath} from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

async function extensionFixture({legacy=false, stale=false, remote=false}={}) {
  const source=await readFile(new URL('../extensions/pi/gentle-office.ts',import.meta.url),'utf8');
  const body=stripTypeScriptTypes(source).replace(/^import .*;\n/gm,'').replace('export default function','return function');
  const url=`http://${remote?'example.com':'127.0.0.1'}:12345/?token=${'a'.repeat(48)}`;
  const notices=[], requests=[], commands={}, events={}, opened=[];
  let generation='first', restarts=0;
  const revision=await sourceRevision();
  const mockRead=async(file,encoding)=>file.endsWith('hub.json') ? JSON.stringify({url,pid:2147483647}) : readFile(file,encoding);
  const mockFetch=async(target,options={})=>{
    const pathname=new URL(target).pathname;requests.push([pathname,options.method??'GET']);
    if(pathname==='/control/status') return new Response(legacy?'':JSON.stringify({service:'gentle-office',protocol:1,revision:stale?'0'.repeat(64):revision,generation}),{status:legacy?404:200});
    if(pathname==='/control/restart') {restarts++;generation='next';return new Response('{}');}
    return new Response(JSON.stringify({id:'retained-id'}));
  };
  const factory=new Function('spawn','createHash','existsSync','readFile','homedir','join','fetch','process',body)(
    (...args)=>{opened.push(args);return {on(){},unref(){}};},createHash,()=>true,mockRead,()=>'/home/user',path.join,mockFetch,
    {pid:123,execPath:'node',platform:'linux',env:{GENTLE_OFFICE_DIR:projectRoot}});
  factory({registerCommand(name,command){commands[name]=command;},on(name,handler){events[name]=handler;}});
  const ctx={cwd:'/project',sessionManager:{getSessionFile:()=>'/mock/session.jsonl'},ui:{notify:(...args)=>notices.push(args)}};
  return {run:args=>commands.office.handler(args,ctx),shutdown:()=>events.session_shutdown(),notices,requests,opened,restarts:()=>restarts};
}

test('extension offers stale update explicitly and retains shutdown ownership after restart', async () => {
  const ext=await extensionFixture({stale:true});
  await ext.run('');
  assert.ok(ext.notices.some(([text])=>text.includes('update pending')));
  assert.equal(ext.restarts(),0);
  await ext.run('restart');
  assert.equal(ext.restarts(),1);assert.equal(ext.opened.length,1);
  await ext.shutdown();
  assert.deepEqual(ext.requests.at(-1),['/sessions/retained-id','DELETE']);
});

test('extension refuses unsafe legacy restart but keeps ordinary registration', async () => {
  const ext=await extensionFixture({legacy:true});
  await ext.run('restart');
  assert.equal(ext.restarts(),0);assert.equal(ext.opened.length,0);
  assert.ok(ext.notices.some(([text])=>text.includes('initial migration')));
  assert.ok(!ext.requests.some(([,method])=>method==='POST'));
  await ext.run('');
  assert.ok(ext.requests.some(([url,method])=>url==='/sessions' && method==='POST'));
});

test('extension current revision stays quiet and unknown actions do not contact the hub', async () => {
  const ext=await extensionFixture();
  await ext.run('delete');assert.equal(ext.requests.length,0);
  await ext.run('');assert.equal(ext.notices.some(([text])=>text.includes('pending')),false);
  await ext.run('');assert.equal(ext.opened.length,1);
});
