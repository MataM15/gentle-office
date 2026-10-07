const token = new URL(import.meta.url).searchParams.get('token');
const asset = name => new URL(`/${name}?token=${encodeURIComponent(token)}`, location.href).href;
const {createScene, desks, createActionGesture, observeLifecycle, createWorkers, bubbleAnchor, officeLighting, createErrorFeedback} = await import(asset('office_scene.mjs'));
const {officeLayout, officeScale} = await import(asset('layout.mjs'));
const avatar = new Image();
avatar.src = asset('avatar.svg');
await avatar.decode();
const office = document.querySelector('#office');
const grid = document.querySelector('#offices'), empty = document.querySelector('#empty');
const instances = new Map();
let connected = false, pipWindow = null;
function createOffice(id) {
const cell = document.createElement('section');
cell.className = 'office-cell';
const title = document.createElement('h2');
title.className = 'office-title';
const viewport = document.createElement('div');
viewport.className = 'viewport';
const scene = document.createElement('div');
scene.className = 'scene';
const canvas = document.createElement('canvas');
canvas.width = 640; canvas.height = 432;
canvas.setAttribute('aria-label', 'Agent office');
const bubbles = document.createElement('div'); bubbles.className = 'bubbles';
scene.append(canvas, bubbles); viewport.append(scene); cell.append(title, viewport);
grid.append(cell);
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;
const renderer = createScene(ctx, avatar);
const nodes = desks.map(() => {
  const bubble = document.createElement('span');
  bubble.className = 'bubble';
  bubbles.append(bubble);
  return {bubble};
});
let status = null, lifecycle = null;
const gestures = createActionGesture();
const workers = createWorkers();
const errorFeedback = createErrorFeedback();
function clearJourneys() {
  workers.reset();
  errorFeedback.reset();
  gestures.disconnect();
}
function update(snapshot) {
  const hadSession = !!status?.session;
  status = snapshot;
  lifecycle = observeLifecycle(lifecycle, status);
  if (lifecycle.reset || (hadSession && !status.session)) clearJourneys();
  workers.observe(lifecycle.events);
  errorFeedback.observe(status, performance.now());
  gestures.observe(status, performance.now());
  title.textContent = status.cwd;
}
function resize(availableHeight, count) {
  const scale = officeScale(Math.min(viewport.clientWidth / 640, availableHeight / 432), count);
  scene.style.width = `${640 * scale}px`;
  scene.style.height = `${432 * scale}px`;
  scene.classList.toggle('compact', scale <= 1);
  scene.style.setProperty('--bubble-scale', Math.min(1, scale));
}
function draw(now, delta) {
  const tick = Math.floor(Date.now() / 240), agents = {};
  const {walk, reviewWalk, trip, tool, review, label:memoryKind} = gestures.step(now, delta);
  const workerPoses = workers.step(delta,
    status?.session ? status.agents.map(a => a.role) : [], connected);
  desks.forEach((d, i) => {
    const matches = status?.agents.filter(a => a.role === d.id) ?? [];
    const orchestrator = d.id === 'orchestrator';
    const active = orchestrator ? status?.orchestrator : matches[0];
    const working = connected && !!status?.session && (orchestrator ? !!active?.working : !!active);
    const workerPose = workerPoses[d.id];
    const text = !connected ? 'offline'
      : workerPose?.book && workerPose.text ? workerPose.text
      : active?.state === 'unknown' ? `Unconfirmed${matches.length > 1 ? ` · ${matches.length}` : ''}`
      : !orchestrator && active ? `Delegated${matches.length > 1 ? ` · ${matches.length}` : ''}`
      : workerPose?.text ? workerPose.text
      : orchestrator && walk.away ? memoryKind ?? 'Checking memory'
      : orchestrator && reviewWalk.away ? 'Reviewing code'
      : orchestrator ? active?.activity ?? 'Waiting'
      : active ? `${active.state === 'unknown' ? 'Unconfirmed' : 'Delegated task'}${matches.length > 1 ? ` · ${matches.length}` : ''}` : 'Waiting';
    agents[d.id] = {working, hand:working ? tick % 2 : 0, bob:working ? tick % 2 : 0, phase:tick};
    const pose = orchestrator ? (trip.away ? trip : {...trip, tool}) : workerPose;
    if (pose) Object.assign(agents[d.id], pose);
    if (orchestrator) agents[d.id].error = connected && !!status?.session && errorFeedback.active(now);
    const n = nodes[i];
    n.bubble.classList.toggle('idle', !active && !workerPose?.book);
    n.bubble.classList.toggle('narrow', pose?.phase === 'stacks' && !pose.moving);
    const resting = connected && !active && workerPose?.phase === 'rest' && text === 'Resting';
    n.bubble.style.display = resting ? 'none' : 'flex';
    const name = d.id[0].toUpperCase() + d.id.slice(1);
    n.bubble.textContent = orchestrator || pose?.phase === 'stacks' && !pose.moving ? text : `${name}\n${text}`;
    n.bubble.setAttribute('aria-label', `${name}: ${text}`);
    n.bubble.setAttribute('data-position', JSON.stringify(pose?.away ? pose.position : [d.x+38,d.y+8]));
    n.bubble.setAttribute('data-phase', pose?.phase ?? 'seat');
    n.bubble.setAttribute('data-away', String(!!pose?.away));
    n.bubble.setAttribute('data-moving', String(!!pose?.moving));
    const [x, y, width, height] = bubbleAnchor(d.id, pose);
    n.bubble.style.left = `${x / 640 * 100}%`;
    n.bubble.style.top = `${y / 432 * 100}%`;
    n.bubble.style.width = `${width / 640 * 100}%`;
    n.bubble.style.minHeight = `${height / 432 * 100}%`;
    n.bubble.style.borderColor = d.color;
  });
  renderer.render({agents, review, lighting:officeLighting(), time:now / 1000});
}
return {update, draw, resize, disconnect() { lifecycle = null; errorFeedback.reset(); gestures.disconnect(); }, destroy() { cell.remove(); }};
}
const connection = document.querySelector('#connection');
function indicator() {
  connection.textContent = connected ? 'connected' : 'offline';
}
const stream = new EventSource(asset('events'));
stream.onmessage = event => {
  const {offices} = JSON.parse(event.data);
  connected = true;
  const ids = new Set(offices.map(o => o.id));
  for (const [id, instance] of instances) if (!ids.has(id)) { instance.destroy(); instances.delete(id); }
  for (const snapshot of offices) {
    if (!instances.has(snapshot.id)) instances.set(snapshot.id, createOffice(snapshot.id));
    instances.get(snapshot.id).update(snapshot);
  }
  empty.hidden = offices.length > 0;
  document.querySelector('h1').textContent = offices.length === 1 ? `Gentle Office · ${offices[0].cwd} (live)` : 'Gentle Office';
  indicator(); resize();
};
stream.onerror = () => { connected = false; for (const instance of instances.values()) instance.disconnect(); indicator(); };
function resize() {
  const win = office.ownerDocument.defaultView;
  const count = instances.size;
  const sideHeight = count > 0 && win.innerWidth < 960 ? office.querySelector('#side').offsetHeight + 12 : 0;
  const height = win.innerHeight - grid.getBoundingClientRect().top - sideHeight - 12;
  const layout = officeLayout(count, grid.clientWidth || win.innerWidth, height);
  office.classList.toggle('multiple', count > 1);
  office.classList.toggle('empty', count === 0);
  grid.style.gridTemplateColumns = `repeat(${layout.columns}, minmax(0, 1fr))`;
  for (const instance of instances.values()) instance.resize(count > 1 ? (height - (layout.rows - 1) * 12) / layout.rows - 28 : height, count);
}
const observer = new ResizeObserver(resize);
observer.observe(office);
observer.observe(document.querySelector('#side'));
window.addEventListener('resize', resize);
let lastFrame = performance.now(), animationWindow = window, animationId;
function draw() {
  const now = performance.now(), delta = (now - lastFrame) / 1000;
  lastFrame = now;
  for (const instance of instances.values()) instance.draw(now, delta);
  animationId = animationWindow.requestAnimationFrame(draw);
}
function resumeAnimation() {
  animationWindow.cancelAnimationFrame(animationId);
  animationWindow = office.ownerDocument.defaultView;
  lastFrame = performance.now();
  draw();
}
draw();
const compactButton = document.querySelector('#compact');
let compact = false, openingPip = false;
function applyCompact() {
  office.classList.toggle('room-first', compact || !!pipWindow);
  compactButton.setAttribute('aria-pressed', String(compact));
  resize();
}
compactButton.onclick = () => { compact = !compact; applyCompact(); };
const homeAnchor = document.createComment('office home');
office.before(homeAnchor);
const button = document.querySelector('#pip');
if (!('documentPictureInPicture' in window)) {
  button.disabled = true;
  button.title = 'Requires Document Picture-in-Picture in a compatible Chrome or Edge';
}
button.onclick = async () => {
  if (pipWindow) { pipWindow.focus(); return; }
  if (openingPip) return;
  openingPip = true;
  try {
    pipWindow = await window.documentPictureInPicture.requestWindow({width:664, height:484});
    applyCompact();
    const sheet = document.createElement('link');
    sheet.rel = 'stylesheet';
    sheet.href = asset('style.css');
    sheet.onload = resize;
    pipWindow.document.head.append(sheet);
    pipWindow.document.title = 'Gentle Office';
    const pipStatus = document.createElement('p');
    pipStatus.className = 'pip-status';
    pipWindow.document.body.append(pipStatus, office);
    const update = setInterval(() => {
      pipStatus.textContent = `Gentle Office · ${instances.size} sessions · ${connection.textContent}`;
    }, 400);
    pipWindow.addEventListener('resize', resize);
    pipWindow.addEventListener('pagehide', () => {
      clearInterval(update);
      homeAnchor.after(office);
      pipWindow = null;
      applyCompact();
      resumeAnimation();
    }, {once:true});
    resize();
    resumeAnimation();
  } catch {
    pipWindow?.close();
    homeAnchor.after(office);
    pipWindow = null;
    applyCompact();
    resumeAnimation();
    button.title = 'Could not open the window; please try again';
  } finally { openingPip = false; }
};
