import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as layoutModule from '../public/layout.mjs';
import * as sceneModule from '../public/office_scene.mjs';
import {createWorkers, reviewWalker} from '../public/office_scene.mjs';

test('compact PiP moves the same office, restores placement and preference, and recovers from denial', async () => {
  const source = await readFile(new URL('../public/app.mjs', import.meta.url), 'utf8');
  const nodes = new Map();
  function node(doc) {
    const classes = new Set();
    return {ownerDocument:doc, style:{setProperty() {}}, offsetHeight:0, clientWidth:664, children:[],
      remove() { this.parent.children = this.parent.children.filter(n => n !== this); },
      classList:{toggle(name, on) { on ? classes.add(name) : classes.delete(name); }, contains:name => classes.has(name)},
      setAttribute(name, value) { this[name] = value; },
      append(...items) { for (const item of items) {
        if (item.parent) item.parent.children = item.parent.children.filter(n => n !== item);
        item.parent = this; item.ownerDocument = this.ownerDocument; this.children.push(item);
      } },
      before(anchor) { this.parent.append(anchor); },
      after(item) { this.parent.append(item); },
      querySelector:selector => nodes.get(selector),
      getBoundingClientRect:() => ({top:40}),
    };
  }
  const makeWindow = () => ({innerWidth:664, innerHeight:484, matchMedia:() => ({matches:false}),
    addEventListener(name, handler) { this[name] = handler; },
    requestAnimationFrame() { this.frames = (this.frames ?? 0) + 1; return this.frames; },
    cancelAnimationFrame() {}, focus() {}, close() { this.pagehide?.(); }});
  const win = makeWindow(), pip = makeWindow();
  function makeDocument(owner) {
    const doc = {defaultView:owner, querySelector:selector => nodes.get(selector)};
    doc.createElement = tag => { const n = node(doc); if (tag === 'canvas') n.getContext = () => ({}); return n; }; doc.createComment = () => node(doc);
    doc.body = node(doc); doc.head = node(doc); owner.document = doc;
    return doc;
  }
  const doc = makeDocument(win); makeDocument(pip);
  for (const selector of ['#office', '#offices', '#empty', '#scene', 'canvas', '#bubbles', '#connection', '#viewport', '#side', 'h1', '#compact', '#pip']) nodes.set(selector, node(doc));
  const office = nodes.get('#office'); doc.body.append(office);
  nodes.get('canvas').getContext = () => ({});
  let requests = 0, deny = false;
  win.documentPictureInPicture = {async requestWindow(options) {
    requests++; assert.deepEqual(options, {width:664, height:484});
    if (deny) throw new Error('denied'); return pip;
  }};
  const timers = new Set();
  const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
  const body = source.replace(/^const token = .*\nconst asset = .*\nconst \{.*\} = await import\(asset\('office_scene.mjs'\)\);/, 'const asset = name => name; const {createScene, desks, memoryWalk, memoryTravelSeconds, reviewWalker, observeLifecycle, createWorkers, bubbleAnchor} = helpers;').replace("const {officeLayout, officeScale} = await import(asset('layout.mjs'));", 'const {officeLayout, officeScale} = helpers;');
  const run = new AsyncFunction('window', 'document', 'Image', 'EventSource', 'ResizeObserver', 'helpers', 'setInterval', 'clearInterval',
    'const {officeLighting, createErrorFeedback, createActionGesture} = helpers;\n' + body);
  let stream, resets = 0;
  const observed = [];
  await run(win, doc, class { async decode() {} }, class {constructor() {stream = this;}}, class { observe() {} },
    {...sceneModule, ...layoutModule, createScene:() => ({render() {}}), createWorkers:() => {
      const workers = createWorkers();
      return {...workers, reset() {resets++; workers.reset();},
        observe(events) {observed.push(...events); workers.observe(events);}};
    }},
    fn => { timers.add(fn); return fn; }, fn => timers.delete(fn));
  const snapshot = {id:'one', cwd:'project', epoch:'test', sequence:3, session:true, agents:[], events:[{role:'writer',type:'arrival',sequence:3}]};
  const send = (offices=[snapshot]) => stream.onmessage({data:JSON.stringify({offices})});
  send(); assert.equal(resets, 1); assert.equal(observed.length, 0);
  snapshot.sequence = 4; snapshot.events.push({role:'writer',type:'result',state:'completed',sequence:4});
  send(); send(); assert.equal(observed.length, 1);
  stream.onerror(); assert.equal(resets, 1); // freeze, do not discard actor positions
  send(); assert.equal(resets, 2); assert.equal(observed.length, 1); // no replay
  snapshot.session = false;
  send(); send(); assert.equal(resets, 3); // repeated empty snapshots cannot reverse the return repeatedly
  send([snapshot, {...snapshot,id:'two',cwd:'other'}]);
  assert.equal(nodes.get('#offices').children.length, 2);
  assert.equal(resets, 4, 'new office gets an independent lifecycle baseline');
  send();
  assert.equal(nodes.get('#offices').children.length, 1);
  const compact = nodes.get('#compact'), button = nodes.get('#pip');
  compact.onclick();
  assert.equal(compact['aria-pressed'], 'true');
  const opening = button.onclick(); await button.onclick(); await opening;
  assert.equal(requests, 1);
  assert.equal(office.ownerDocument, pip.document);
  assert.equal(office.classList.contains('room-first'), true);
  assert.ok(pip.frames > 0);
  send([snapshot, {...snapshot,id:'pip-office',cwd:'new-project'}]);
  assert.equal(nodes.get('#offices').children.length, 2);
  assert.equal(office.classList.contains('multiple'), true);
  pip.pagehide();
  assert.equal(office.ownerDocument, doc);
  assert.equal(office.classList.contains('room-first'), true);
  assert.equal(timers.size, 0);
  compact.onclick(); deny = true; await button.onclick();
  assert.equal(office.ownerDocument, doc);
  assert.equal(office.classList.contains('room-first'), false);
  send([]);
  assert.equal(nodes.get('#offices').children.length, 0);
  assert.equal(nodes.get('#empty').hidden, false);
  assert.equal(office.classList.contains('empty'), true);
});

test('each office in a hub shows its own tool gestures and review trip', async () => {
  const source = await readFile(new URL('../public/app.mjs', import.meta.url), 'utf8');
  const nodes = new Map();
  const node = doc => ({ownerDocument:doc, style:{setProperty() {}}, offsetHeight:0, clientWidth:664, children:[],
    classList:{toggle() {}}, setAttribute(name, value) { this[name] = value; },
    append(...items) { for (const item of items) { item.parent = this; this.children.push(item); } },
    before() {}, after() {}, remove() {}, querySelector:selector => nodes.get(selector),
    getBoundingClientRect:() => ({top:40})});
  let frame = null, now = 0;
  const win = {innerWidth:1066, innerHeight:1870, addEventListener() {}, cancelAnimationFrame() {},
    requestAnimationFrame(fn) { frame = fn; return 1; }};
  const doc = {defaultView:win, querySelector:selector => nodes.get(selector), createComment:() => node(doc)};
  doc.createElement = tag => { const n = node(doc); if (tag === 'canvas') n.getContext = () => ({}); return n; };
  for (const selector of ['#office', '#offices', '#empty', '#connection', '#side', 'h1', '#compact', '#pip']) nodes.set(selector, node(doc));
  const body = source.replace(/^const token = .*\nconst asset = .*\nconst \{.*\} = await import\(asset\('office_scene.mjs'\)\);/, 'const asset = name => name; const {createScene, desks, memoryWalk, memoryTravelSeconds, reviewWalker, observeLifecycle, createWorkers, bubbleAnchor} = helpers;').replace("const {officeLayout, officeScale} = await import(asset('layout.mjs'));", 'const {officeLayout, officeScale} = helpers;');
  const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
  const run = new AsyncFunction('window', 'document', 'Image', 'EventSource', 'ResizeObserver', 'helpers', 'performance',
    'const {officeLighting, createErrorFeedback, createActionGesture} = helpers;\n' + body);
  const frames = [];
  let stream;
  await run(win, doc, class { async decode() {} }, class { constructor() { stream = this; } }, class { observe() {} },
    {...sceneModule, ...layoutModule, createScene:() => ({render(state) { frames.push(state); }})},
    {now:() => now});
  const office = (id, tool, working=true) => ({id, cwd:id, epoch:'e', sequence:1, session:true, agents:[], events:[],
    orchestrator:{working, activity:'Thinking', kind:null, memory:{count:0, kind:null}, tool, action:tool}});
  const tick = (seconds, step=1 / 30) => { for (let t = 0; t < seconds; t += step) { now += step * 1000; frames.length = 0; frame(); } };
  stream.onmessage({data:JSON.stringify({offices:[office('a', {count:0, kind:null}), office('b', {count:0, kind:null})]})});
  tick(.1);
  // A finished bash call in office a, and a review in office b, both between polls during active turn.
  stream.onmessage({data:JSON.stringify({offices:[office('a', {count:1, kind:'bash'}), office('b', {count:1, kind:'review'})]})});
  tick(.5);
  const [a, b] = frames.map(state => state.agents.orchestrator);
  assert.equal(a.tool?.kind, 'bash');
  assert.equal(a.away, false);
  assert.equal(b.tool, undefined);
  assert.equal(b.away, true, 'review makes only office b walk');
  tick(reviewWalker.travelSeconds);
  assert.ok(frames[1].review?.stamper, 'office b stamps at the review desk');
  assert.equal(frames[0].agents.orchestrator.tool?.kind, 'bash', 'active gesture lasts beyond 4.5 seconds');
  assert.equal(frames[0].review, null);
  tick(reviewWalker.travelSeconds + 7);
  assert.equal(frames[1].agents.orchestrator.away, true, 'active review remains at its desk');
  assert.ok(frames[1].review?.stamper);
  // When turn finishes and enters 'Waiting' (working:false), all gestures cut off immediately
  stream.onmessage({data:JSON.stringify({offices:[office('a', {count:2, kind:'write'}), office('b', {count:1, kind:null}, false)]})});
  tick(.1);
  assert.equal(frames[1].agents.orchestrator.tool ?? null, null, 'idle office does not show gesture when waiting for prompt');
  assert.equal(frames[1].review, null, 'stamp stops before return finishes');
  tick(reviewWalker.travelSeconds);
  assert.equal(frames[1].agents.orchestrator.away, false, 'office b returns safely');
  const failure = {...office('a', {count:2, kind:null}, false)};
  failure.orchestrator.errorCount = 1;
  const other = office('b', {count:1, kind:null}, false);
  const send = () => stream.onmessage({data:JSON.stringify({offices:[failure, other]})});
  send(); tick(.1);
  assert.equal(frames[0].agents.orchestrator.error, true);
  assert.equal(frames[1].agents.orchestrator.error, false);
  assert.ok(frames.every(state => ['day','evening','night'].includes(state.lighting.period)));
  assert.ok(frames.every(state => state.time === now / 1000), 'the animation clock reaches the renderer');
  tick(3);
  assert.equal(frames[0].agents.orchestrator.error, false);
  stream.onerror(); failure.orchestrator.errorCount = 2; send(); tick(.1);
  assert.equal(frames[0].agents.orchestrator.error, false, 'reconnect is a baseline');
  // Workers receive their delegation state and how long their oldest task has run.
  const delegated = (id, role, state, age) => ({id, role, state, started:Date.now() - age * 1000});
  const busy = {...office('a', {count:2, kind:null}, false),
    agents:[delegated(1, 'writer', 'delegated', 120), delegated(2, 'writer', 'unknown', 30), delegated(3, 'scout', 'unknown', 5)]};
  stream.onmessage({data:JSON.stringify({offices:[busy, other]})}); tick(.1);
  const [writer, scout, verifier] = ['writer', 'scout', 'verifier'].map(role => frames[0].agents[role]);
  assert.equal(writer.agentState, 'delegated');
  assert.ok(writer.activeSeconds >= 119.9 && writer.activeSeconds < 125, `oldest task counts (${writer.activeSeconds})`);
  assert.equal(scout.agentState, 'unknown');
  assert.ok(scout.activeSeconds < 10);
  assert.equal(verifier.agentState, undefined, 'idle workers carry no state');
  assert.equal(verifier.activeSeconds, undefined);
  assert.equal(frames[0].agents.orchestrator.agentState, undefined);
  assert.equal(frames[1].agents.writer.activeSeconds, undefined, 'other offices are independent');
});
