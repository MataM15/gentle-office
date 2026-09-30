#!/usr/bin/env node
import http from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { readFile, realpath, stat, mkdir, chmod, writeFile, rename, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Capture the revision at module load, not when a later client asks for it.
// Paths are relative to the project root, one level above this file.
const projectRoot = new URL('../', import.meta.url);
const sourceFiles = ['src/server.mjs','src/status.mjs','public/index.html','public/app.mjs','public/layout.mjs','public/office_scene.mjs','public/style.css','public/avatar.svg'];
export async function sourceRevision() {
  const hash=createHash('sha256');
  for(const file of sourceFiles) hash.update(file).update(await readFile(new URL(file,projectRoot)));
  return hash.digest('hex');
}
const loadedRevision=await sourceRevision();
const { Tail, encodeCwd, newestSession } = await import(`./status.mjs?revision=${loadedRevision}`);

const publicDir = new URL('public/', projectRoot);
export async function startServer({session, cwd=process.cwd(), port=0, sessionRoot=path.join(os.homedir(), '.pi/agent/sessions'), interval=400,
  hub=false, exitWhenEmpty=false, emptyDelay=10000, stateFile=path.join(os.homedir(), '.local/state/gentle-office/hub.json'),
  _handoff=null, _runtime={}}={}) {
  cwd = path.resolve(cwd);
  const dir = path.join(sessionRoot,encodeCwd(cwd));
  const token = _handoff?.token ?? randomBytes(24).toString('hex'), offices = new Map(), clients = new Set();
  for(const [id,o] of _handoff?.offices ?? []) offices.set(id,{file:o.file,cwd:o.cwd,owner:o.owner,tail:new Tail()});
  const generation=randomUUID();
  let restarting=false, mutations=0;
  if (!hub) offices.set('single', {cwd, tail:new Tail()});
  let latest={offices:[]}, timer, emptyTimer, registered=_handoff?.registered ?? false, stopped=false, polling, closing;
  function emptyCheck() {
    if (stopped) return;
    if (offices.size || !registered) { clearTimeout(emptyTimer); emptyTimer=null; }
    else if (exitWhenEmpty && !emptyTimer) emptyTimer=setTimeout(()=>{void close();},emptyDelay);
  }
  function publish() {
    latest={offices:[...offices].filter(([,o])=>o.snapshot).map(([id,o])=>({id,...o.snapshot}))};
    for (const client of clients) if (!client.write(`data: ${JSON.stringify(latest)}\n\n`)) {
      clients.delete(client); client.destroy();
    }
    emptyCheck();
  }
  async function poll() {
    for (const [id,o] of offices) {
      if (o.loading) continue;
      if (hub) {
        try { process.kill(o.owner,0); }
        catch (e) { if (e.code==='ESRCH') { offices.delete(id); continue; } }
      }
      const file=hub ? o.file : session ? path.resolve(session) : await newestSession(dir);
      // Revalidate registered paths so a replaced symlink cannot escape the root.
      let safe=file;
      if (hub) { try { safe=await validatedFile(file); } catch { safe=null; } }
      const present=await o.tail.poll(safe);
      o.snapshot=o.tail.status.snapshot(o.cwd,present);
    }
    publish();
  }
  async function validatedFile(file) {
    if (typeof file!=='string' || !path.isAbsolute(file) || !file.endsWith('.jsonl')) throw new Error('file');
    const [base, resolved]=await Promise.all([realpath(sessionRoot),realpath(file)]);
    const relative=path.relative(base,resolved);
    if (!relative || relative==='..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !(await stat(resolved)).isFile()) throw new Error('file');
    return resolved;
  }
  await poll();
  const assets={'/app.mjs':'text/javascript','/layout.mjs':'text/javascript','/office_scene.mjs':'text/javascript','/avatar.svg':'image/svg+xml','/style.css':'text/css'};
  const handler=async(req,res)=>{
    const allowed=[`127.0.0.1:${server.address()?.port}`,`localhost:${server.address()?.port}`];
    let url;
    try { url=new URL(req.url,'http://127.0.0.1'); } catch { res.writeHead(400);res.end();return; }
    if (!allowed.includes(req.headers.host)||url.searchParams.get('token')!==token) {res.writeHead(403);res.end('Access denied');return;}
    const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://raw.githubusercontent.com; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"};
    const reply=(code,data)=>{res.writeHead(code,{...headers,'Content-Type':'application/json'});res.end(data ? JSON.stringify(data) : undefined);};
    if(hub && req.method==='GET' && url.pathname==='/control/status') {
      reply(200,{service:'gentle-office',protocol:1,revision:loadedRevision,generation,restarting,sessions:offices.size});return;
    }
    if(hub && req.method==='POST' && url.pathname==='/control/restart') {
      // No payload, cross-origin requests or concurrent mutations during handoff.
      if(req.headers.origin || req.headers['transfer-encoding'] || Number(req.headers['content-length'] ?? 0)!==0) {reply(400);return;}
      if(restarting) {reply(409);return;}
      restarting=true;
      try {
        const next=await import(`./server.mjs?reload=${randomUUID()}`);
        const deadline=Date.now()+5000;
        while(mutations) {
          if(Date.now()>deadline) throw new Error('busy');
          await new Promise(resolve=>setTimeout(resolve,10));
        }
        stopped=true;clearTimeout(timer);clearTimeout(emptyTimer);await polling;
        await next.startServer({cwd,port,sessionRoot,interval,hub,exitWhenEmpty,emptyDelay,stateFile,
          _handoff:{server,token,offices,registered},_runtime});
        for(const signal of ['SIGINT','SIGTERM']) process.removeListener(signal,onSignal);
        for(const c of clients)c.end();clients.clear();
        reply(200,{restarted:true});
      } catch {
        const resume=stopped;stopped=false;restarting=false;
        if(resume) schedule();
        emptyCheck();reply(500,{restarted:false});
      }
      return;
    }
    if(hub && restarting && ['POST','DELETE'].includes(req.method)) {reply(503);return;}
    if (hub && req.method==='POST' && url.pathname==='/sessions') {
      mutations++;
      req.setTimeout(3000,()=>req.destroy());
      try {
        const chunks=[]; let size=0;
        for await (const chunk of req) {
          size+=chunk.length;
          if(size>4096) {reply(400);req.resume();return;}
          chunks.push(chunk);
        }
        const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!Number.isSafeInteger(input?.owner)||input.owner<=0||input.owner>2147483647||typeof input.cwd!=='string'||!input.cwd) throw new Error('input');
        const file=await validatedFile(input.file);
        if(stopped) {reply(503);return;}
        const existing=[...offices].find(([,o])=>o.file===file);
        if(existing) {existing[1].owner=input.owner;reply(200,{id:existing[0]});return;}
        if(offices.size>=8) throw new Error('limit');
        const id=randomUUID(), tail=new Tail();
        const o={file,cwd:path.basename(input.cwd),owner:input.owner,tail,loading:true};
        offices.set(id,o);registered=true;emptyCheck();
        const present=await tail.poll(file);
        o.snapshot=tail.status.snapshot(o.cwd,present);o.loading=false;
        publish();reply(200,{id});
      } catch {if(!res.destroyed)reply(400);} finally {mutations--;if(req.socket)req.setTimeout(0);}
      return;
    }
    if(hub && req.method==='DELETE' && url.pathname.startsWith('/sessions/')) {
      const removed=offices.delete(url.pathname.slice('/sessions/'.length));
      publish();reply(removed?204:404);return;
    }
    if(req.method!=='GET') {reply(405);return;}
    if(url.pathname==='/events') {
      res.writeHead(200,{...headers,'Content-Type':'text/event-stream','Connection':'keep-alive'});
      res.write(`data: ${JSON.stringify(latest)}\n\n`);clients.add(res);res.on('close',()=>clients.delete(res));return;
    }
    const file=url.pathname==='/'?'index.html':assets[url.pathname]?url.pathname.slice(1):null;
    if(!file) {reply(404);return;}
    try {
      let data=await readFile(new URL(file,publicDir));
      if(file==='index.html') data=data.toString().replaceAll('__TOKEN__',token);
      res.writeHead(200,{...headers,'Content-Type':file==='index.html'?'text/html; charset=utf-8':assets[url.pathname]});res.end(data);
    } catch {reply(500);}
  };
  const server=_handoff?.server ?? http.createServer();
  if(!_handoff) {
    server.on('request',handler);
    server.requestTimeout=5000;
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  }
  const url=`http://127.0.0.1:${server.address().port}/?token=${token}`;
  async function close() {
    if(closing) return closing;
    stopped=true;clearTimeout(timer);clearTimeout(emptyTimer);
    closing=(async()=>{
      await polling;
      for(const c of clients)c.end();clients.clear();
      await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
      if(hub) {
        for(const signal of ['SIGINT','SIGTERM']) process.removeListener(signal,onSignal);
        try {const state=JSON.parse(await readFile(stateFile,'utf8'));if(state.pid===process.pid && state.url===url) await unlink(stateFile);} catch(e) {if(e.code!=='ENOENT') throw e;}
      }
    })();
    return closing;
  }
  const onSignal=()=>{void close();};
  if(hub) {
    try {
      if(!_handoff) {
      await mkdir(path.dirname(stateFile),{recursive:true,mode:0o700});
      await chmod(path.dirname(stateFile),0o700);
      const temp=`${stateFile}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temp,JSON.stringify({url,port:server.address().port,pid:process.pid}),{mode:0o600,flag:'wx'});
      await rename(temp,stateFile);
      }
      for(const signal of ['SIGINT','SIGTERM'])process.once(signal,onSignal);
    } catch(e) {await close();throw e;}
  }
  function schedule() {timer=setTimeout(()=>{polling=poll().finally(()=>{if(!stopped)schedule();});},interval);}
  if(_handoff) {server.removeAllListeners('request');server.on('request',handler);}
  _runtime.close=close;_runtime.snapshot=()=>latest;
  schedule();
  return {url,snapshot:()=>_runtime.snapshot(),close:()=>_runtime.close()};
}
// Resolve symlinks so an installed `gentle-office` bin link still starts the CLI.
const entryPoint=file=>{try {return realpathSync(file);} catch {return path.resolve(file);}};
if(!new URL(import.meta.url).search && process.argv[1] && entryPoint(process.argv[1])===fileURLToPath(import.meta.url)) {
  const options={};
  for(let i=2;i<process.argv.length;i++) {
    const key=process.argv[i];
    if(key==='--hub') options.hub=true;
    else if(key==='--exit-when-empty') options.exitWhenEmpty=true;
    else if(['--session','--cwd','--port'].includes(key) && process.argv[i+1]) {
      const value=process.argv[++i];options[key.slice(2)]=key==='--port'?Number(value):value;
    } else throw new Error('Usage: node src/server.mjs [--hub] [--exit-when-empty] [--session file.jsonl] [--cwd directory] [--port N]');
  }
  const app=await startServer(options);console.log(app.url);
  if(!options.hub) for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void app.close();});
}
